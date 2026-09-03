#!/usr/bin/env bash
set -Eeuo pipefail

cli_name="$(basename "$0")"
source_path="${BASH_SOURCE[0]}"
while [[ -L "${source_path}" ]]; do
    source_dir="$(cd "$(dirname "${source_path}")" && pwd)"
    source_path="$(readlink "${source_path}")"
    if [[ "${source_path}" != /* ]]; then
        source_path="${source_dir}/${source_path}"
    fi
done
script_dir="$(cd "$(dirname "${source_path}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
tools_image="${FABRIC_TOOLS_IMAGE:-ghcr.io/hyperledger/fabric-tools:2.5.16}"
ca_image="${FABRIC_CA_IMAGE:-ghcr.io/hyperledger/fabric-ca:1.5.17}"
network_name="${FABRIC_CONTAINER_NETWORK:-fabric_test}"
network_mode="${FABRIC_CLI_NETWORK_MODE:-host}"

case "${cli_name}" in
    fabric-ca-client)
        cli_image="${ca_image}"
        ;;
    peer|configtxgen|configtxlator|osnadmin|cryptogen|discover)
        cli_image="${tools_image}"
        ;;
    *)
        echo "Unsupported Fabric container CLI name: ${cli_name}" >&2
        exit 64
        ;;
esac

map_endpoint() {
    local value="$1"
    value="${value//localhost:7050/orderer.example.com:7050}"
    value="${value//127.0.0.1:7050/orderer.example.com:7050}"
    value="${value//localhost:7053/orderer.example.com:7053}"
    value="${value//127.0.0.1:7053/orderer.example.com:7053}"
    value="${value//localhost:7051/peer0.org1.example.com:7051}"
    value="${value//127.0.0.1:7051/peer0.org1.example.com:7051}"
    value="${value//localhost:9051/peer0.org2.example.com:9051}"
    value="${value//127.0.0.1:9051/peer0.org2.example.com:9051}"
    value="${value//localhost:7054/ca_org1:7054}"
    value="${value//127.0.0.1:7054/ca_org1:7054}"
    value="${value//localhost:8054/ca_org2:8054}"
    value="${value//127.0.0.1:8054/ca_org2:8054}"
    value="${value//localhost:9054/ca_orderer:9054}"
    value="${value//127.0.0.1:9054/ca_orderer:9054}"
    printf '%s' "${value}"
}

docker_args=(
    run
    --rm
    --user "$(id -u):$(id -g)"
    --volume "${project_root}:${project_root}"
    --workdir "${PWD}"
)

map_container_endpoints=false
if docker network inspect "${network_name}" >/dev/null 2>&1; then
    if [[ "${network_mode}" == "host" ]]; then
        docker_args+=(--network host)
    else
        docker_args+=(--network "${network_name}")
        map_container_endpoints=true
    fi
fi

while IFS='=' read -r env_name _; do
    case "${env_name}" in
        CORE_*|ORDERER_*|FABRIC_*|DISCOVERY_*|CHANNEL_NAME|CC_*)
            env_value="${!env_name}"
            if [[ "${map_container_endpoints}" == true ]]; then
                env_value="$(map_endpoint "${env_value}")"
            fi
            docker_args+=(--env "${env_name}=${env_value}")
            ;;
    esac
done < <(env)

mapped_args=()
for argument in "$@"; do
    if [[ "${map_container_endpoints}" == true ]]; then
        argument="$(map_endpoint "${argument}")"
    fi
    mapped_args+=("${argument}")
done

exec docker "${docker_args[@]}" "${cli_image}" "${cli_name}" "${mapped_args[@]}"
