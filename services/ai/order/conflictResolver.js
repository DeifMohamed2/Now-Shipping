/**
 * Stage 4 — Conflict resolution: keep / replace / delete per field.
 */

const POST_STRUCTURAL = new Set([
  'COD',
  'codConfirmed',
  'amountCOD',
  'isExpressShipping',
  'shippingSpeedConfirmed',
]);

function fieldMatchesPending(field, pendingField) {
  if (!pendingField) return false;
  const map = {
    zone: 'zoneQuery',
    codConfirmation: 'codConfirmed',
    shippingSpeed: 'isExpressShipping',
  };
  const mapped = map[pendingField] || pendingField;
  return field === mapped || field === pendingField;
}

/**
 * @returns {Array<{ field: string, action: 'replace'|'keep'|'delete', value?: *, meta?: object }>}
 */
function resolveConflicts({
  existingDraft = {},
  validatedEntities = [],
  intent = 'answer_question',
  correction = false,
  deleteFields = [],
  pendingField = null,
}) {
  const decisions = [];
  const isUpdate = intent === 'update' || intent === 'delete_field' || correction === true;
  const touched = new Set();

  for (const v of validatedEntities) {
    const field = v.field;
    if (touched.has(field)) continue;
    touched.add(field);

    const hasExisting =
      existingDraft[field] !== undefined &&
      existingDraft[field] !== null &&
      existingDraft[field] !== '';

    let action = 'replace';

    if (intent === 'answer_question' && fieldMatchesPending(field, pendingField)) {
      action = 'replace';
    } else if (isUpdate) {
      action = 'replace';
    } else if (!hasExisting) {
      action = 'replace';
    } else if (hasExisting) {
      action = 'keep';
    }

    if (action === 'replace') {
      decisions.push({
        field,
        action: 'replace',
        value: v.value,
        meta: {
          COD: v.COD,
          codConfirmed: v.codConfirmed,
        },
      });
    }
  }

  for (const field of deleteFields || []) {
    if (!field) continue;
    decisions.push({ field, action: 'delete' });
  }

  if (intent === 'answer_question' && pendingField && !touched.size) {
    /* no-op — caller handles empty extraction */
  }

  return decisions;
}

function shouldAllowPostStructural(decisions, structuralComplete) {
  if (!structuralComplete) return false;
  return decisions.some((d) => POST_STRUCTURAL.has(d.field) || d.field === 'amountCOD');
}

module.exports = {
  resolveConflicts,
  shouldAllowPostStructural,
};
