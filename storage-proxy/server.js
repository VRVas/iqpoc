const express = require('express')
const cors = require('cors')
const multer = require('multer')
const { BlobServiceClient } = require('@azure/storage-blob')
const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity')

const app = express()
app.use(cors())
app.use(express.json())

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
})

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.docm', '.xlsx', '.xls', '.xlsm',
  '.pptx', '.ppt', '.pptm', '.msg', '.eml', '.epub',
  '.html', '.htm', '.json', '.csv', '.md', '.txt', '.rtf',
  '.xml', '.kml', '.odt', '.ods', '.odp', '.gz', '.zip',
])

// ---------- Storage client ----------

function getStorageClient() {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME
  if (!accountName) throw new Error('AZURE_STORAGE_ACCOUNT_NAME not set')

  const clientId = process.env.AZURE_CLIENT_ID
  const credential = clientId
    ? new ManagedIdentityCredential(clientId)
    : new DefaultAzureCredential()

  return new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential
  )
}

// ---------- Routes ----------

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// List containers
app.get('/containers', async (_req, res) => {
  try {
    const client = getStorageClient()
    const containers = []
    for await (const c of client.listContainers()) {
      containers.push(c.name)
    }
    res.json({ containers })
  } catch (err) {
    console.error('List containers error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Create container
app.post('/containers', async (req, res) => {
  try {
    const { name } = req.body
    if (!name || !/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(name)) {
      return res.status(400).json({
        error: 'Container name must be 3-63 chars, lowercase alphanumeric and hyphens only',
      })
    }
    const client = getStorageClient()
    const containerClient = client.getContainerClient(name)
    const exists = await containerClient.exists()
    if (exists) {
      return res.json({ created: false, name, message: 'Container already exists' })
    }
    await containerClient.create()
    res.status(201).json({ created: true, name })
  } catch (err) {
    console.error('Create container error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// List blobs / virtual folders in a container
app.get('/blobs', async (req, res) => {
  try {
    const { container, prefix } = req.query
    if (!container) return res.status(400).json({ error: 'container is required' })

    const client = getStorageClient()
    const containerClient = client.getContainerClient(container)

    const folders = []
    const blobs = []

    for await (const item of containerClient.listBlobsByHierarchy('/', {
      prefix: prefix || '',
    })) {
      if (item.kind === 'prefix') {
        folders.push(item.name)
      } else {
        blobs.push({ name: item.name, size: item.properties?.contentLength })
      }
    }
    res.json({ folders, blobs })
  } catch (err) {
    console.error('List blobs error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Upload files
app.post('/upload', upload.array('files', 50), async (req, res) => {
  try {
    const { container, folder } = req.body
    if (!container) return res.status(400).json({ error: 'container is required' })
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' })
    }

    // Validate extensions
    for (const file of req.files) {
      const ext = '.' + file.originalname.split('.').pop().toLowerCase()
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return res.status(415).json({
          error: `Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
          file: file.originalname,
        })
      }
    }

    const client = getStorageClient()
    const containerClient = client.getContainerClient(container)

    // Ensure container exists
    const exists = await containerClient.exists()
    if (!exists) {
      await containerClient.create()
    }

    const uploaded = []
    for (const file of req.files) {
      const blobPath = folder
        ? `${folder.replace(/\/+$/, '')}/${file.originalname}`
        : file.originalname

      const blockBlobClient = containerClient.getBlockBlobClient(blobPath)
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      })

      uploaded.push({
        name: file.originalname,
        path: blobPath,
        size: file.size,
        contentType: file.mimetype,
      })
    }

    res.status(201).json({ uploaded, count: uploaded.length })
  } catch (err) {
    console.error('Upload error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------- AI Insights K:V (blob-backed) ----------

const INSIGHTS_CONTAINER = 'ai-insights'

// GET /insights/:key — read a saved insight
app.get('/insights/:key', async (req, res) => {
  try {
    const client = getStorageClient()
    const containerClient = client.getContainerClient(INSIGHTS_CONTAINER)
    const blobClient = containerClient.getBlobClient(`${req.params.key}.json`)
    const exists = await blobClient.exists()
    if (!exists) return res.status(404).json({ error: 'Not found' })
    const dl = await blobClient.download(0)
    const chunks = []
    for await (const chunk of dl.readableStreamBody) chunks.push(chunk)
    const data = JSON.parse(Buffer.concat(chunks).toString())
    res.json(data)
  } catch (err) {
    console.error('Read insight error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /insights/:key — save an insight
app.put('/insights/:key', async (req, res) => {
  try {
    const client = getStorageClient()
    const containerClient = client.getContainerClient(INSIGHTS_CONTAINER)
    await containerClient.createIfNotExists()
    const blockBlobClient = containerClient.getBlockBlobClient(`${req.params.key}.json`)
    const body = JSON.stringify(req.body)
    await blockBlobClient.upload(body, body.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    })
    res.json({ saved: true, key: req.params.key })
  } catch (err) {
    console.error('Save insight error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------- Start ----------

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Storage proxy listening on port ${PORT}`))
