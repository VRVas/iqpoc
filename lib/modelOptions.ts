export interface ModelDeploymentOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Chat/completion deployments that ACTUALLY exist on the AI Services account
 * backing this app (`aikb-foundry-q36gpyt3maa7w`). Verified 2026-08-06 with
 * `az cognitiveservices account deployment list -n aikb-foundry-q36gpyt3maa7w -g iqpoc`.
 *
 * Keep in sync with the `deployments` array in infra/main-iqpoc.bicep. Offering a
 * deployment that isn't provisioned makes Azure fail the call with an opaque
 * error, so never add a value here speculatively. Removed in this pass because
 * they were never deployed: gpt-4o, gpt-4.1-nano, gpt-5-nano, gpt-5-mini.
 *
 * Embedding deployments (text-embedding-3-small/large) are deliberately absent —
 * this list feeds chat/completion pickers only.
 */
export const MODEL_DEPLOYMENTS: ModelDeploymentOption[] = [
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Recommended — fast reasoning, 1000 TPM' },
  { value: 'gpt-5.2', label: 'GPT-5.2', description: 'Highest quality, slower' },
  { value: 'gpt-5', label: 'GPT-5', description: 'Previous flagship' },
  { value: 'gpt-4.1', label: 'GPT-4.1', description: 'High performance' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Fast and efficient' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Legacy deployment alias (serves gpt-4.1-mini)' },
];

/**
 * Default deployment for BOTH the Foundry agent LLM and Azure AI Search agentic
 * retrieval. Verified end-to-end against both APIs on 2026-08-06.
 */
export const DEFAULT_MODEL_DEPLOYMENT = 'gpt-5.4-mini';
