import { Router, IRouter } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { providerKeyManager } from "../lib/provider-key-manager";

const router: IRouter = Router();

// Load keys from .env and validate them
router.post("/admin/provider-keys/load-env", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const loaded = providerKeyManager.loadFromEnv();
  const validation = await providerKeyManager.validateAll();
  providerKeyManager.startHealthChecks();
  res.json({ loaded, validation });
});

// Bulk import keys for a model
router.post("/admin/provider-keys/bulk-import", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { model, keys } = req.body as { model: string; keys: string[] };
  if (!model || !Array.isArray(keys) || keys.length === 0) {
    res.status(400).json({ error: "model and keys[] are required" });
    return;
  }
  const added = providerKeyManager.loadBulkKeys(model, keys);
  res.json({ added, totalKeys: providerKeyManager.getStatus().totalKeys });
});

// Validate all keys
router.post("/admin/provider-keys/validate-all", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const result = await providerKeyManager.validateAll();
  res.json(result);
});

// Get all keys (masked) with status
router.get("/admin/provider-keys", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  res.json({ keys: providerKeyManager.getSafeEntries() });
});

// Get status summary
router.get("/admin/provider-keys/status", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  res.json(providerKeyManager.getStatus());
});

// Get available models
router.get("/admin/provider-keys/models", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  res.json({ models: providerKeyManager.getAvailableModels() });
});

// Toggle key active/inactive
router.patch("/admin/provider-keys/:keyPrefix/status", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const keyPrefix = Array.isArray(req.params.keyPrefix) ? req.params.keyPrefix[0] : req.params.keyPrefix;
  const { model, status } = req.body as { model: string; status: "active" | "inactive" };
  if (!model || !status) {
    res.status(400).json({ error: "model and status are required" });
    return;
  }
  const ok = providerKeyManager.setKeyStatus(model, keyPrefix, status);
  if (!ok) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json({ success: true });
});

// Remove a key
router.delete("/admin/provider-keys/:keyPrefix", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const keyPrefix = Array.isArray(req.params.keyPrefix) ? req.params.keyPrefix[0] : req.params.keyPrefix;
  const { model } = req.body as { model: string };
  if (!model) {
    res.status(400).json({ error: "model is required in body" });
    return;
  }
  const ok = providerKeyManager.removeKey(model, keyPrefix);
  if (!ok) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json({ success: true });
});

// Pick best key for a model (for internal/testing use)
router.get("/admin/provider-keys/pick", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const model = req.query.model as string;
  const entry = providerKeyManager.pickKey(model);
  if (!entry) {
    res.status(404).json({ error: "No active key found for model" });
    return;
  }
  res.json({
    keyPrefix: entry.key.slice(0, 12) + "..." + entry.key.slice(-4),
    model: entry.model,
    status: entry.status,
    latencyMs: entry.latencyMs,
  });
});

export default router;
