#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
runtime_bin="${FABRIC_RUNTIME_DIR:-${project_root}/.fabric-runtime/fabric-samples}/bin"
wrapper="${project_root}/scripts/fabric-cli-container.sh"

if [[ ! -x "${wrapper}" ]]; then
    echo "Fabric CLI wrapper is not executable: ${wrapper}" >&2
    exit 1
fi

mkdir -p "${runtime_bin}"

for cli_name in peer configtxgen configtxlator osnadmin cryptogen discover fabric-ca-client; do
    ln -sfn "${wrapper}" "${runtime_bin}/${cli_name}"
done

echo "Fabric container CLI wrappers installed in ${runtime_bin}"
