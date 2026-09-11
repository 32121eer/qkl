#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    buildCases, parseCsv, round, summarizeAnnotations
} = require('./extended_model_benchmark');

function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeDisagreementPacket(annotationDirectory, disagreements) {
    const cases = new Map(buildCases().map((item) => [item.id, item]));
    const packet = ['disagreement_id,case_text,annotator_a,annotator_b,adjudicated_label,notes'];
    const crosswalk = ['disagreement_id,case_id,oracle_label'];
    disagreements.forEach((disagreement, index) => {
        const disagreementId = `D${String(index + 1).padStart(3, '0')}`;
        const item = cases.get(disagreement.caseId);
        packet.push([
            disagreementId, item.text, disagreement.annotatorA, disagreement.annotatorB, '', ''
        ].map(csvCell).join(','));
        crosswalk.push([disagreementId, item.id, item.truth].map(csvCell).join(','));
    });
    const packetPath = path.join(annotationDirectory, 'disagreements_blind.csv');
    const crosswalkPath = path.join(annotationDirectory, 'admin_disagreement_crosswalk.csv');
    const expectedCrosswalk = `${crosswalk.join('\n')}\n`;
    if (!fs.existsSync(packetPath)) fs.writeFileSync(packetPath, `${packet.join('\n')}\n`);
    if (!fs.existsSync(crosswalkPath)) fs.writeFileSync(crosswalkPath, expectedCrosswalk);
    else if (fs.readFileSync(crosswalkPath, 'utf8') !== expectedCrosswalk) {
        throw new Error(`${crosswalkPath}: existing disagreement crosswalk is stale; archive it before rerunning`);
    }
    return packetPath;
}

function readAdjudication(annotationDirectory, filename, expectedCount) {
    const crosswalk = parseCsv(fs.readFileSync(
        path.join(annotationDirectory, 'admin_disagreement_crosswalk.csv'), 'utf8'
    ));
    const oracle = new Map(crosswalk.map((row) => [row.disagreement_id, row.oracle_label]));
    const rows = parseCsv(fs.readFileSync(filename, 'utf8'));
    if (rows.length !== expectedCount) {
        throw new Error(`${filename}: expected ${expectedCount} disagreement rows, found ${rows.length}`);
    }
    let correct = 0; const seen = new Set();
    for (const row of rows) {
        if (!oracle.has(row.disagreement_id)) {
            throw new Error(`${filename}: unknown disagreement_id ${row.disagreement_id}`);
        }
        if (seen.has(row.disagreement_id)) {
            throw new Error(`${filename}: duplicate disagreement_id ${row.disagreement_id}`);
        }
        seen.add(row.disagreement_id);
        const label = String(row.adjudicated_label || '').trim().toUpperCase();
        if (!['ACCEPT', 'REJECT'].includes(label)) {
            throw new Error(`${filename}: ${row.disagreement_id} requires ACCEPT or REJECT`);
        }
        if (label === oracle.get(row.disagreement_id)) correct += 1;
    }
    if (seen.size !== oracle.size) throw new Error(`${filename}: disagreement set is incomplete`);
    return {
        completed: rows.length,
        accuracyAgainstDeterministicOracle: rows.length ? round(correct / rows.length) : null
    };
}

function main() {
    const annotationDirectory = path.resolve(process.argv[2] || process.env.ANNOTATION_DIR || '.');
    const summary = summarizeAnnotations(annotationDirectory);
    if (summary.disagreements.length) {
        summary.disagreementPacket = writeDisagreementPacket(annotationDirectory, summary.disagreements);
    }
    const adjudicationFile = process.env.ADJUDICATION_FILE;
    if (adjudicationFile) {
        summary.adjudication = readAdjudication(
            annotationDirectory, path.resolve(adjudicationFile), summary.disagreements.length
        );
    }
    const target = path.join(annotationDirectory, 'annotation_summary.json');
    fs.writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${target}\n`);
}

if (require.main === module) main();

module.exports = { main, readAdjudication, writeDisagreementPacket };
