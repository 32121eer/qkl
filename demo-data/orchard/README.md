# Orchard Demo JSON Sources

These files are prepared for the `Cross-Chain Query` page import flow.

## Import-compatible root formats

The page supports:

- JSON array: `[ {...}, {...} ]`
- Object with `items`: `{ "items": [ ... ] }`
- Object with `records`: `{ "records": [ ... ] }`
- Object with `data`: `{ "data": [ ... ] }`
- Single object: `{ ... }`

## Suggested usage

1. Open `http://localhost:15173/app-query`
2. In `A 链数据池（Fabric）`, choose one of these files
3. Select an imported record from dropdown
4. Click `写入 A 链记录`
5. On the right panel click `从 FISCO 发起查询 -> Fabric`

## Files

- `orchard_single_cultivation_batch_0001.json`: one record
- `orchard_lifecycle_batch_0001.items.json`: same batch, multiple lifecycle events
- `orchard_multi_batch.records.json`: multi-batch dataset
- `orchard_query_hotset.data.json`: compact query-oriented dataset

