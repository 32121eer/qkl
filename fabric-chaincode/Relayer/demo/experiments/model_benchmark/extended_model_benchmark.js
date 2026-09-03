'use strict';

const fs = require('node:fs');
const path = require('node:path');

function round(value, digits = 6) {
    return Number(Number(value).toFixed(digits));
}

function isoDate(dayOffset) {
    return new Date(Date.UTC(2026, 0, 1 + dayOffset)).toISOString().slice(0, 10);
}

function buildCases() {
    const cases = [];
    for (let index = 0; index < 20; index += 1) {
        const accept = index % 2 === 0;
        const deadline = 30 + index;
        const shipment = deadline + (accept ? -(index % 4) : 1 + (index % 4));
        cases.push({
            id: `deadline-${String(index + 1).padStart(3, '0')}`,
            family: 'deadline', truth: accept ? 'ACCEPT' : 'REJECT',
            text: `Supply-chain financing. Inclusive shipment deadline: ${isoDate(deadline)}. ` +
                `On-chain shipment date: ${isoDate(shipment)}. Rule: shipment must occur on or before the deadline. Satisfied?`
        });

        const limit = 100000 + (index * 2500);
        const invoice = limit + (accept ? -(100 + index) : 100 + index);
        cases.push({
            id: `credit-${String(index + 1).padStart(3, '0')}`,
            family: 'credit_limit', truth: accept ? 'ACCEPT' : 'REJECT',
            text: `Invoice financing. Approved limit: ${limit} CNY. On-chain invoice total: ${invoice} CNY. ` +
                'Rule: invoice total must not exceed the approved limit. Satisfied?'
        });

        const ordered = 1000 + (index * 20);
        const tolerance = 0.02;
        const delivered = accept
            ? Math.round(ordered * (1 + (index % 3) * 0.005))
            : Math.round(ordered * (1.021 + (index % 3) * 0.004));
        cases.push({
            id: `tolerance-${String(index + 1).padStart(3, '0')}`,
            family: 'quantity_tolerance', truth: accept ? 'ACCEPT' : 'REJECT',
            text: `Purchase order quantity: ${ordered}. Delivered quantity on chain: ${delivered}. ` +
                `Rule: absolute quantity deviation must be at most ${tolerance * 100}%. Satisfied?`
        });

        const quarterEnd = 90 + index;
        const filing = quarterEnd + (accept ? 30 - (index % 5) : 31 + (index % 5));
        cases.push({
            id: `filing-${String(index + 1).padStart(3, '0')}`,
            family: 'regulatory_window', truth: accept ? 'ACCEPT' : 'REJECT',
            text: `Regulatory filing. Quarter end: ${isoDate(quarterEnd)}. On-chain filing date: ${isoDate(filing)}. ` +
                'Rule: file within 30 calendar days after quarter end, inclusive. Satisfied?'
        });

        const min = 2;
        const max = 8;
        const readings = accept
            ? [2.1 + index * 0.01, 4.0, 7.9 - index * 0.01]
            : [3.5, index % 4 === 1 ? 1.8 : 8.2, 5.0];
        cases.push({
            id: `coldchain-${String(index + 1).padStart(3, '0')}`,
            family: 'cold_chain', truth: accept ? 'ACCEPT' : 'REJECT',
            text: `Cold-chain evidence. Allowed range: ${min}C to ${max}C inclusive. ` +
                `On-chain readings: ${readings.map((value) => value.toFixed(2)).join(', ')} C. ` +
                'Rule: every reading must remain within range. Satisfied?'
        });

        const usdLimit = 50000 + (index * 500);
        const fx = 7 + ((index % 5) * 0.05);
        const cnyInvoice = Math.round(usdLimit * fx + (accept ? -500 : 500));
        cases.push({
            id: `fx-${String(index + 1).padStart(3, '0')}`,
            family: 'foreign_exchange', truth: accept ? 'ACCEPT' : 'REJECT',
            text: `Multi-currency financing. Approved limit: ${usdLimit} USD. Reference rate: 1 USD = ${fx.toFixed(2)} CNY. ` +
                `On-chain invoice: ${cnyInvoice} CNY. Rule: converted invoice must not exceed the USD limit. Satisfied?`
        });
    }
    return cases;
}

function parseVerdict(text) {
    const match = String(text || '').match(/\{[^{}]*\}/);
    if (!match) return null;
    let value;
    try { value = JSON.parse(match[0]); } catch (_error) { return null; }
    const judgment = String(value.judgment || '').toUpperCase();
    const confidence = Number(value.confidence);
    if (!['ACCEPT', 'REJECT'].includes(judgment) || !Number.isFinite(confidence)) return null;
    return { judgment, confidence: Math.max(0, Math.min(1, confidence)) };
}

function ece(samples, bins = 10) {
    if (!samples.length) return null;
    let total = 0;
    for (let bin = 0; bin < bins; bin += 1) {
        const lower = bin / bins;
        const upper = (bin + 1) / bins;
        const selected = samples.filter((sample) => sample.confidence >= lower
            && (bin === bins - 1 ? sample.confidence <= upper : sample.confidence < upper));
        if (!selected.length) continue;
        const accuracy = selected.filter((sample) => sample.correct).length / selected.length;
        const confidence = selected.reduce((sum, sample) => sum + sample.confidence, 0) / selected.length;
        total += (selected.length / samples.length) * Math.abs(accuracy - confidence);
    }
    return round(total);
}

function summarizeSamples(samples) {
    const completed = samples.filter((sample) => !sample.error && sample.judgment);
    const accepts = completed.filter((sample) => sample.truth === 'ACCEPT');
    const rejects = completed.filter((sample) => sample.truth === 'REJECT');
    if (!completed.length) {
        return {
            requested: samples.length,
            completed: 0,
            errors: samples.length,
            accuracy: null,
            falseAcceptRate: null,
            falseRejectRate: null,
            meanConfidence: null,
            brierScore: null,
            expectedCalibrationError: null
        };
    }
    const brier = completed.map((sample) => {
        const probabilityAccept = sample.judgment === 'ACCEPT' ? sample.confidence : 1 - sample.confidence;
        const label = sample.truth === 'ACCEPT' ? 1 : 0;
        return (probabilityAccept - label) ** 2;
    });
    return {
        requested: samples.length,
        completed: completed.length,
        errors: samples.length - completed.length,
        accuracy: round(completed.filter((sample) => sample.correct).length / completed.length),
        falseAcceptRate: rejects.length
            ? round(rejects.filter((sample) => sample.judgment === 'ACCEPT').length / rejects.length)
            : null,
        falseRejectRate: accepts.length
            ? round(accepts.filter((sample) => sample.judgment === 'REJECT').length / accepts.length)
            : null,
        meanConfidence: round(completed.reduce((sum, sample) => sum + sample.confidence, 0) / completed.length),
        brierScore: round(brier.reduce((sum, value) => sum + value, 0) / brier.length),
        expectedCalibrationError: ece(completed)
    };
}

function pearson(left, right) {
    if (!left.length || left.length !== right.length) return null;
    const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
    const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
    let numerator = 0; let leftSum = 0; let rightSum = 0;
    for (let index = 0; index < left.length; index += 1) {
        const l = left[index] - leftMean;
        const r = right[index] - rightMean;
        numerator += l * r; leftSum += l * l; rightSum += r * r;
    }
    if (!leftSum || !rightSum) return 0;
    return round(numerator / Math.sqrt(leftSum * rightSum));
}

function writeDataset(outputDirectory) {
    const cases = buildCases();
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'cases.json'), `${JSON.stringify({
        schemaVersion: 'semantic-model-benchmark-cases-v1',
        labelSource: 'deterministic rule oracle independent of evaluated models',
        caseCount: cases.length,
        cases
    }, null, 2)}\n`);
    const csvRows = ['case_id,family,oracle_label,annotator_a,annotator_b,adjudicated_label'];
    for (const item of cases) csvRows.push(`${item.id},${item.family},${item.truth},,,`);
    fs.writeFileSync(path.join(outputDirectory, 'independent_annotation_template.csv'), `${csvRows.join('\n')}\n`);
    return cases;
}

if (require.main === module) {
    const outputDirectory = path.resolve(process.argv[2] || path.join(__dirname, 'results'));
    const cases = writeDataset(outputDirectory);
    process.stdout.write(`${path.join(outputDirectory, 'cases.json')} (${cases.length} cases)\n`);
}

module.exports = { buildCases, ece, parseVerdict, pearson, round, summarizeSamples, writeDataset };
