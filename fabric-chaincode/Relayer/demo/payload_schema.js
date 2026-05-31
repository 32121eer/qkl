const Ajv = require('ajv');
let addFormats = null;
try {
    addFormats = require('ajv-formats');
} catch (_error) {
    addFormats = null;
}

const ORCHARD_PAYLOAD_V1_SCHEMA = require('./schemas/orchard_payload_v1.schema.json');

function buildOrchardValidator() {
    const ajv = new Ajv({
        allErrors: true,
        strict: false
    });
    if (addFormats) {
        addFormats(ajv);
    }
    const validate = ajv.compile(ORCHARD_PAYLOAD_V1_SCHEMA);

    return (payload) => {
        const valid = validate(payload);
        if (valid) {
            return { valid: true, errors: [] };
        }
        const errors = (validate.errors || []).map((item) => ({
            field: item.instancePath || item.schemaPath,
            message: item.message || 'invalid value'
        }));
        return { valid: false, errors };
    };
}

module.exports = {
    ORCHARD_PAYLOAD_V1_SCHEMA,
    buildOrchardValidator
};
