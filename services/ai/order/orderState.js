/**
 * Stage 5 — Pure order draft state reducer.
 */
const { ORDER_DRAFT_DEFAULTS } = require('../orderDraftService');

/**
 * Apply conflict decisions to draft fields (no inference, no side effects).
 */
function applyEntities(existingDraft = {}, decisions = []) {
  const next = { ...ORDER_DRAFT_DEFAULTS, ...existingDraft };

  for (const d of decisions) {
    if (d.action === 'delete') {
      if (d.field === 'zoneQuery') {
        delete next.zoneQuery;
        delete next.government;
        delete next.zone;
      } else if (d.field === 'codConfirmed') {
        next.codConfirmed = false;
        next.COD = false;
        delete next.amountCOD;
      } else {
        delete next[d.field];
      }
      continue;
    }

    if (d.action !== 'replace') continue;

    const field = d.field;
    const value = d.value;

    if (field === 'zoneQuery') {
      next.zoneQuery = value;
      if (d.meta?.replaceZone || value) {
        delete next.government;
        delete next.zone;
      }
    } else if (field === 'replaceZone' && value === true) {
      next.replaceZone = true;
      delete next.government;
      delete next.zone;
    } else if (field === 'codConfirmed') {
      next.codConfirmed = true;
      if (d.meta?.COD !== undefined) next.COD = d.meta.COD;
      else if (typeof d.COD === 'boolean') next.COD = d.COD;
      if (!next.COD) delete next.amountCOD;
    } else if (field === 'amountCOD') {
      next.amountCOD = value;
      next.COD = true;
      next.codConfirmed = true;
    } else if (field === 'isExpressShipping') {
      next.isExpressShipping = value === true;
      next.shippingSpeedConfirmed = true;
    } else {
      next[field] = value;
    }
  }

  return next;
}

/**
 * Convert validated entities + decisions into flat field patch for region resolver.
 */
function decisionsToFieldPatch(decisions) {
  const patch = {};
  for (const d of decisions) {
    if (d.action !== 'replace') continue;
    patch[d.field] = d.value;
    if (d.meta?.COD !== undefined) patch.COD = d.meta.COD;
    if (d.field === 'codConfirmed' && d.meta?.COD !== undefined) {
      patch.codConfirmed = true;
      patch.COD = d.meta.COD;
    }
  }
  return patch;
}

module.exports = {
  applyEntities,
  decisionsToFieldPatch,
};
