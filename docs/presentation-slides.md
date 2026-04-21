# Presentation Slides — Contact Center AI Companion

> 4 slides to precede the Architecture Diagram and Agent Dataflow slides.

---

## SLIDE 0 — Intro: "The Vision"

**Title:** Contact Center AI Companion

**Subtitle:** Augmenting operators with real-time AI — grounded in your knowledge, connected to your operations

**Three anchor statements (vertically stacked, large type, centered):**

> **Know instantly.** Every company policy, procedure, and document 

> **Act in context.** Live airport operations, flight data, and passenger metrics

> **Trust completely.** 26 built-in evaluators for quality, safety, and compliance 

**Bottom strip — 3 technology badges (horizontal, centered):**
`Azure AI Search` · `Azure AI Foundry Agent Service` · `Model Context Protocol (MCP)`

**Footer:** _Microsoft × Qatar Airways_

---

## SLIDE 1 — Operator View: "The Agent Experience"

**Title:** Real-Time AI Companion for Contact Center Operators

**Subtitle:** Everything an operator needs — in one conversation

**Body (4 pillars, each with icon + 1-liner):**

| | Pillar | Description |
|---|---|---|
| 💬 | **Ask Anything, Get Cited Answers** | Operators type natural-language questions and receive grounded responses with inline source citations — every answer is traceable to company documentation. |
| ✈️ | **Live Airport Operations** | 40+ real-time tools surface flight delays, gate assignments, runway usage, passenger stats, and baggage performance directly in the conversation — no app switching. |
| 🔧 | **Multi-Tool Intelligence** | The agent autonomously decides when to search knowledge bases, run Python analysis, or query airport systems — operators just ask. |
| 🚀 | **Conversation Starters & Voice** | Pre-built starter questions accelerate common scenarios; voice input enables hands-free operation during live calls. |

**Footer tagline:** _Powered by Azure AI Foundry · Azure AI Search · MCP_

---

## SLIDE 2 — Admin View: "From Knowledge to Agent"

**Title:** Agent Lifecycle — Connect, Build, Deploy

**Subtitle:** End-to-end journey from raw data to a production-ready AI agent

**Visual: 4-step horizontal pipeline (left → right)**

| Step | Label | Key Details |
|------|-------|-------------|
| **1** | **Connect Knowledge** | 6 source types: Azure Blob, Web URLs, SharePoint (Indexed & Remote), OneLake, AI Search Index. Per-source runtime tuning: reranker thresholds, freshness, query routing. |
| **2** | **Create Knowledge Base** | Azure AI Search builds vector + semantic indexes automatically. Embedding models: text-embedding-3-small / large. MCP endpoint provisioned per KB. |
| **3** | **Build Agent** | 4-step wizard: **Model** (GPT-4.1 → GPT-5 family, 8 models) · **Tools** (KB Retrieval, Code Interpreter, Airport Ops MCP) · **Instructions** (system prompt) · **Knowledge** (select KBs). |
| **4** | **Deploy & Iterate** | Agent versioning — every update creates a new version. Instant playground testing. Export conversations as JSONL datasets for evaluation. |

**Footer tagline:** _No code required — fully managed by Azure AI Foundry Agent Service_

---

## SLIDE 3 — Admin View: "Evaluate & Trust"

**Title:** Continuous Evaluation — Quality, Safety & Compliance

**Subtitle:** 26 built-in evaluators + custom domain evaluators across 4 execution modes

**Left column — Evaluation Modes (4 cards, stacked):**

| Mode | Description |
|------|-------------|
| **Agent Target** | Send live queries to the agent, score real responses |
| **Synthetic** | AI-generated test questions from a prompt template |
| **Dataset** | Score pre-collected Q&A pairs (JSONL) |
| **Red Teaming** | Adversarial attacks — jailbreak, base64 encoding, indirect injection |

**Right column — Evaluator Categories (concentric rings or grouped badges):**

| Category | Count | Highlights |
|----------|-------|------------|
| **Quality** | 2 | Coherence, Fluency |
| **RAG** | 5 | Groundedness, Groundedness Pro, Relevance, Retrieval, Response Completeness |
| **Safety** | 9 | Violence, Hate, Sexual, Self-Harm, Protected Material, Indirect Attack, Code Vulnerability, Ungrounded Attributes |
| **Agent** | 8 | Task Adherence, Tool Call Accuracy, Tool Selection, Tool Input Accuracy, Tool Output Utilization, Intent Resolution |
| **Custom** | 3 | KB Citation, MCP Accuracy, QR Policy Style |

**Bottom banner:**
_Continuous Evaluation triggers on every agent response · Auto-injects tool definitions · Per-item drill-down with full retrieval trace_

---

# Image Generation Prompts

All four prompts share this **design system preamble** (include at start of each):

> **Shared design context:** Corporate presentation slide. White (#FFFFFF) background. Primary accent color is deep burgundy (#662046). Secondary tones: warm gray (#818A8F), slate gray (#5E6A71), neutral gray (#8E8F8B). Typography is Aptos font family — titles in Aptos Display Bold, body in Aptos Regular. The logo file `msftxqr.png` is placed in the top-left corner at approximately 120×40px equivalent size. Thin burgundy (#662046) horizontal rule under the title. Subtle geometric accent shapes — thin burgundy lines, soft rounded-rectangle cards with 1px gray (#818A8F) borders and white fill. No stock photos. No 3D renders. Clean, flat, corporate Microsoft-style layout. Generous whitespace. No drop shadows heavier than 2px blur. All icons are simple line-style glyphs in burgundy or slate gray.

---

### PROMPT 0 — Slide 0: Intro

```
[Insert shared design context preamble above]

Create a presentation slide with a bold, centered title "Contact Center AI Companion" in Aptos Display Bold, 44pt, color #662046, positioned in the upper third of the slide, horizontally centered. Below it, a subtitle "Augmenting operators with real-time AI — grounded in your knowledge, connected to your operations" in Aptos Regular, 18pt, color #5E6A71, centered, max width 70% of the slide.

Below the subtitle, leave 40px of whitespace, then render three vertically stacked statement blocks, each horizontally centered, max width 65% of the slide. Each statement block has:
- A bold lead-in phrase in Aptos Bold, 20pt, color #662046, followed by the rest of the sentence in Aptos Regular, 16pt, color #5E6A71, on the same line.
- Statement 1: bold "Know instantly." then "Every company policy, procedure, and document — searchable in natural language with cited sources."
- Statement 2: bold "Act in context." then "Live airport operations, flight data, and passenger metrics — surfaced automatically when relevant."
- Statement 3: bold "Trust completely." then "26 built-in evaluators for quality, safety, and compliance — continuous monitoring from day one."
- Between each statement, a subtle thin horizontal divider line (0.5px, #818A8F, 40% width, centered).

Below the three statements, leave 30px, then a horizontal row of three technology badge pills, centered. Each pill is a rounded rectangle (border-radius 20px, 1px border #662046, white fill, horizontal padding 16px, vertical padding 6px). Text inside each pill is Aptos Regular 12pt #662046. Pill 1: "Azure AI Search". Pill 2: "Azure AI Foundry Agent Service". Pill 3: "Model Context Protocol (MCP)".

At the very bottom center, "Microsoft × Qatar Airways" in Aptos Regular Italic, 11pt, color #8E8F8B.

Subtle decorative element: a faint burgundy (#662046, 6% opacity) large arc shape in the bottom-right corner of the slide, purely decorative, not overlapping any content. A matching mirrored faint arc (same opacity) in the top-left corner behind the logo area.
```

---

### PROMPT 1 — Slide 1: Operator View

```
[Insert shared design context preamble above]

Create a presentation slide titled "Real-Time AI Companion for Contact Center Operators" in Aptos Display Bold, 36pt, color #662046, left-aligned below the logo. Subtitle "Everything an operator needs — in one conversation" in Aptos Regular, 18pt, color #5E6A71, immediately below.

The main content area is divided into a 2×2 grid of four equal cards, each a rounded rectangle (border-radius 12px, 1px border #818A8F, white fill). Inside each card:
- Top-left: a simple line-art icon (32×32px) in #662046. Card 1: a chat bubble with a checkmark inside. Card 2: an airplane silhouette with a small pulse/heartbeat line trailing behind it. Card 3: a wrench crossed with a magnifying glass. Card 4: a microphone with small radiating lines.
- Below the icon: a bold label in Aptos Bold 16pt #662046. Card 1: "Ask Anything, Get Cited Answers". Card 2: "Live Airport Operations". Card 3: "Multi-Tool Intelligence". Card 4: "Conversation Starters & Voice".
- Below the label: a short description in Aptos Regular 12pt #5E6A71, max 2 lines. Card 1: "Grounded responses with inline source citations — every answer traceable to company documentation." Card 2: "40+ real-time tools for flight delays, gates, runways, passengers, and baggage — no app switching." Card 3: "Agent autonomously routes to knowledge bases, Python analysis, or airport systems." Card 4: "Pre-built starters accelerate common scenarios; voice input for hands-free operation."

At the bottom center, a single line in Aptos Regular Italic, 11pt, color #8E8F8B: "Powered by Azure AI Foundry · Azure AI Search · MCP". A very thin (0.5px) horizontal line in #818A8F separates this footer from the cards above.

Subtle decorative element: a faint burgundy (#662046, 6% opacity) large arc shape in the bottom-right corner of the slide, purely decorative, not overlapping any content.
```

---

— Slide 2: Agent Lifecycle

```
**Shared design context:** Corporate presentation slide. White (#FFFFFF) background. Primary accent color is deep burgundy (#662046). Secondary tones: warm gray (#818A8F), slate gray (#5E6A71), neutral gray (#8E8F8B). Typography is Aptos font family — titles in Aptos Display Bold, body in Aptos Regular. The logo file `msftxqr.png` is placed in the top-left corner at approximately 120×40px equivalent size. Thin burgundy (#662046) horizontal rule under the title. Subtle geometric accent shapes — thin burgundy lines, soft rounded-rectangle cards with 1px gray (#818A8F) borders and white fill. No stock photos. No 3D renders. Clean, flat, corporate Microsoft-style layout. Generous whitespace. No drop shadows heavier than 2px blur. All icons are simple line-style glyphs in burgundy or slate gray.

Create a presentation slide titled "Agent Lifecycle — Connect, Build, Deploy" in Aptos Display Bold, 36pt, color #662046, left-aligned below the logo. Subtitle "End-to-end journey from raw data to a production-ready AI agent" in Aptos Regular, 18pt, color #5E6A71, immediately below.

The main content is a horizontal 4-step pipeline spanning the full width, with each step connected by a thin horizontal arrow line (2px, #662046) with a small arrowhead. Each step is a vertical card (rounded rectangle, border-radius 12px, 1px border #818A8F, white fill, equal width).

Step 1 card — top: circle with number "1" in Aptos Bold 20pt white on #662046 solid fill. Below: icon of a plug/connector in line art #662046. Title "Connect Knowledge" in Aptos Bold 14pt #662046. Body in Aptos Regular 11pt #5E6A71: "6 source types: Blob, Web, SharePoint, OneLake, Search Index. Per-source reranker thresholds & query routing."

Step 2 card — top: circle "2" same style. Icon: a database with a magnifying glass overlay. Title "Create Knowledge Base". Body: "Automatic vector + semantic indexing. MCP endpoint provisioned per KB. Embedding: text-embedding-3."

Step 3 card — top: circle "3". Icon: a robot head or gear with a sparkle. Title "Build Agent". Body: "4-step wizard: Model · Tools · Instructions · Knowledge. 8 LLMs from GPT-4.1 to GPT-5."

Step 4 card — top: circle "4". Icon: a rocket or deploy arrow. Title "Deploy & Iterate". Body: "Agent versioning — every update is a new version. Export chats as JSONL for evaluation."

Between steps 3 and 4, a small looping arrow curves back from step 4 to step 3, suggesting iteration, in a lighter tone (#818A8F, dashed).

Footer: "No code required — fully managed by Azure AI Foundry Agent Service" in Aptos Regular Italic, 11pt, #8E8F8B, centered at the bottom.

Same subtle decorative element: faint burgundy arc (6% opacity) in the bottom-right corner.
```

---

### Slide 3: Evaluation

```
**Shared design context:** Corporate presentation slide. White (#FFFFFF) background. Primary accent color is deep burgundy (#662046). Secondary tones: warm gray (#818A8F), slate gray (#5E6A71), neutral gray (#8E8F8B). Typography is Aptos font family — titles in Aptos Display Bold, body in Aptos Regular. The logo file `msftxqr.png` is placed in the top-left corner at approximately 120×40px equivalent size. Thin burgundy (#662046) horizontal rule under the title. Subtle geometric accent shapes — thin burgundy lines, soft rounded-rectangle cards with 1px gray (#818A8F) borders and white fill. No stock photos. No 3D renders. Clean, flat, corporate Microsoft-style layout. Generous whitespace. No drop shadows heavier than 2px blur. All icons are simple line-style glyphs in burgundy or slate gray.

Create a presentation slide titled "Continuous Evaluation — Quality, Safety & Compliance" in Aptos Display Bold, 36pt, color #662046, left-aligned below the logo. Subtitle "26 built-in evaluators + custom domain evaluators across 4 execution modes" in Aptos Regular, 18pt, color #5E6A71, immediately below.

Layout is split into two columns (roughly 40/60 ratio).

LEFT COLUMN — header "Evaluation Modes" in Aptos Bold 14pt #662046. Below it, four stacked horizontal cards (rounded rectangle, border-radius 8px, 1px border #818A8F, white fill, full width of the left column). Each card contains:
- A small colored dot indicator on the left edge (4px wide vertical stripe).
- Card 1: green (#107C10) stripe. Label "Agent Target" in Aptos Bold 12pt. Sub: "Live queries → score real responses" in 10pt #5E6A71.
- Card 2: blue (#0078D4) stripe. Label "Synthetic". Sub: "AI-generated test questions from prompt templates".
- Card 3: gray (#5E6A71) stripe. Label "Dataset". Sub: "Score pre-collected Q&A pairs (JSONL)".
- Card 4: burgundy (#662046) stripe. Label "Red Teaming". Sub: "Adversarial attacks — jailbreak, encoding, indirect injection".

RIGHT COLUMN — header "Evaluator Categories" in Aptos Bold 14pt #662046. Below, a visual of 5 horizontal grouped badge rows, each row representing a category:
- Row 1: label "Quality" in Aptos Bold 11pt #662046, then 2 small rounded pill badges (burgundy outline, white fill) labeled "Coherence" and "Fluency".
- Row 2: label "RAG" then 5 pills: "Groundedness", "Groundedness Pro", "Relevance", "Retrieval", "Completeness".
- Row 3: label "Safety" then a cluster of pills in a slightly different tone (use #662046 fill with white text for these, to emphasize importance): "Violence", "Hate", "Sexual", "Self-Harm", "Protected Material", "Indirect Attack", "Code Vuln".
- Row 4: label "Agent" then 6 pills (back to outline style): "Task Adherence", "Tool Call Accuracy", "Tool Selection", "Tool Input", "Tool Output", "Intent Resolution".
- Row 5: label "Custom" then 3 pills with a subtle gold/amber (#B8860B) outline: "KB Citation", "MCP Accuracy", "QR Policy Style".

At the bottom, a slim horizontal banner bar (full width, background #662046 at 8% opacity, border-radius 6px) containing text in Aptos Regular 11pt #5E6A71: "Continuous evaluation triggers on every response · Auto-injects tool definitions · Per-item drill-down with full retrieval trace".

Same decorative faint burgundy arc in bottom-right corner.
```

---

**END**
