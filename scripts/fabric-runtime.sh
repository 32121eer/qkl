#!/usr/bin/env bash

fabric_network_subnet() {
    echo "${FABRIC_DOCKER_SUBNET:-172.24.240.0/24}"
}

fabric_network_gateway() {
    echo "${FABRIC_DOCKER_GATEWAY:-172.24.240.1}"
}

fabric_patch_network_block() {
    local file="$1"
    local subnet gateway

    [[ -f "$file" ]] || return 0

    subnet="$(fabric_network_subnet)"
    gateway="$(fabric_network_gateway)"

    perl -0pi -e "s#networks:\n  test:\n    name: fabric_test(?:\n    driver: bridge\n    ipam:\n      driver: default\n      config:\n        - subnet: [^\n]+\n          gateway: [^\n]+)?#networks:\n  test:\n    name: fabric_test\n    driver: bridge\n    ipam:\n      driver: default\n      config:\n        - subnet: ${subnet}\n          gateway: ${gateway}#g" "$file"
}

fabric_apply_runtime_network_overrides() {
    local runtime_test_network="$1"
    local compose_files=(
        "$runtime_test_network/compose/compose-test-net.yaml"
        "$runtime_test_network/compose/compose-bft-test-net.yaml"
        "$runtime_test_network/compose/compose-ca.yaml"
        "$runtime_test_network/compose/compose-couch.yaml"
        "$runtime_test_network/addOrg3/compose/compose-org3.yaml"
        "$runtime_test_network/addOrg3/compose/compose-ca-org3.yaml"
        "$runtime_test_network/addOrg3/compose/compose-couch-org3.yaml"
    )
    local file

    for file in "${compose_files[@]}"; do
        fabric_patch_network_block "$file"
    done
}

fabric_normalize_image_tag() {
    local version="$1"
    version="${version#v}"
    echo "$version"
}

fabric_detect_binary_version() {
    local binary_path="$1"
    [[ -x "$binary_path" ]] || return 1

    "$binary_path" version 2>/dev/null | sed -ne 's/^ Version: //p' | head -1
}

fabric_patch_image_reference() {
    local runtime_test_network="$1"
    local image_name="$2"
    local image_tag="$3"

    [[ -n "$image_tag" ]] || return 0

    local files=(
        "$runtime_test_network/network.sh"
        "$runtime_test_network/compose/compose-test-net.yaml"
        "$runtime_test_network/compose/compose-bft-test-net.yaml"
        "$runtime_test_network/compose/compose-ca.yaml"
        "$runtime_test_network/compose/docker/docker-compose-test-net.yaml"
        "$runtime_test_network/compose/docker/docker-compose-bft-test-net.yaml"
        "$runtime_test_network/addOrg3/compose/compose-org3.yaml"
        "$runtime_test_network/addOrg3/compose/compose-ca-org3.yaml"
    )
    local file

    for file in "${files[@]}"; do
        [[ -f "$file" ]] || continue
        perl -0pi -e "s#${image_name}:[A-Za-z0-9._-]+#${image_name}:${image_tag}#g" "$file"
    done
}

fabric_patch_network_cleanup() {
    local runtime_test_network="$1"
    local network_file="$runtime_test_network/network.sh"

    [[ -f "$network_file" ]] || return 0

    perl -0pi -e 's#\$\{CONTAINER_CLI\} volume rm docker_orderer\.example\.com docker_peer0\.org1\.example\.com docker_peer0\.org2\.example\.com#for volume in \$(\$\{CONTAINER_CLI\} volume ls --format '\''{{.Name}}'\'' | grep -E '\''(^|_)(orderer\.example\.com|peer0\.org1\.example\.com|peer0\.org2\.example\.com)\$'\'' || true); do\n    \$\{CONTAINER_CLI\} volume rm \"\$volume\" >/dev/null 2>\&1 || true\n  done#g' "$network_file"
}

fabric_apply_runtime_version_overrides() {
    local runtime_samples_dir="$1"
    local runtime_test_network="$2"
    local peer_version ca_version

    peer_version="$(fabric_detect_binary_version "$runtime_samples_dir/bin/peer" || true)"
    peer_version="$(fabric_normalize_image_tag "$peer_version")"
    if [[ -n "$peer_version" ]]; then
        fabric_patch_image_reference "$runtime_test_network" "hyperledger/fabric-peer" "$peer_version"
        fabric_patch_image_reference "$runtime_test_network" "hyperledger/fabric-orderer" "$peer_version"
    fi

    ca_version="$(fabric_detect_binary_version "$runtime_samples_dir/bin/fabric-ca-client" || true)"
    ca_version="$(fabric_normalize_image_tag "$ca_version")"
    if [[ -n "$ca_version" ]]; then
        fabric_patch_image_reference "$runtime_test_network" "hyperledger/fabric-ca" "$ca_version"
    fi
}

fabric_detect_source_samples_dir() {
    local explicit="${FABRIC_SAMPLES_DIR:-}"
    local candidates=(
        "$explicit"
        "/mnt/fast18/xunuo/czs/fabric-samples"
        "/mnt/fast18/xunuo/czs/fabric-samples-main"
        "/mnt/fast18/xunuo/qukuialian/czs/fabric-samples-main"
        "/home/tr/fabric-samples"
        "/root/czs/fabric/fabric-samples-main"
    )

    for candidate in "${candidates[@]}"; do
        [[ -z "$candidate" ]] && continue
        if [[ "$(basename "$candidate")" == "test-network" ]] && [[ -f "$candidate/network.sh" ]]; then
            dirname "$candidate"
            return 0
        fi
        if [[ -f "$candidate/test-network/network.sh" ]]; then
            echo "$candidate"
            return 0
        fi
    done

    return 1
}

fabric_prepare_runtime() {
    local project_root="$1"
    local source_samples_dir="${2:-}"
    local runtime_samples_dir="${FABRIC_RUNTIME_DIR:-$project_root/.fabric-runtime/fabric-samples}"
    local runtime_test_network="$runtime_samples_dir/test-network"

    if [[ -z "$source_samples_dir" ]]; then
        source_samples_dir="$(fabric_detect_source_samples_dir || true)"
    fi

    if [[ -z "$source_samples_dir" ]]; then
        return 1
    fi

    source_samples_dir="$(cd "$source_samples_dir" && pwd)"
    mkdir -p "$runtime_samples_dir" "$runtime_test_network"

    if [[ "$source_samples_dir" != "$runtime_samples_dir" ]]; then
        if command -v rsync >/dev/null 2>&1; then
            rsync -a --delete \
                --exclude '/channel-artifacts/' \
                --exclude '/organizations/peerOrganizations/' \
                --exclude '/organizations/ordererOrganizations/' \
                --exclude '/organizations/fabric-ca/org1/' \
                --exclude '/organizations/fabric-ca/org2/' \
                --exclude '/organizations/fabric-ca/ordererOrg/' \
                --exclude '/system-genesis-block/' \
                --exclude '/log.txt' \
                --exclude '/*.tar.gz' \
                "$source_samples_dir/test-network/" "$runtime_test_network/"
        elif [[ ! -f "$runtime_test_network/network.sh" ]]; then
            cp -a "$source_samples_dir/test-network/." "$runtime_test_network/"
            rm -rf \
                "$runtime_test_network/channel-artifacts" \
                "$runtime_test_network/organizations/peerOrganizations" \
                "$runtime_test_network/organizations/ordererOrganizations" \
                "$runtime_test_network/system-genesis-block"
            rm -rf \
                "$runtime_test_network/organizations/fabric-ca/org1" \
                "$runtime_test_network/organizations/fabric-ca/org2" \
                "$runtime_test_network/organizations/fabric-ca/ordererOrg"
            rm -f "$runtime_test_network/log.txt" "$runtime_test_network"/*.tar.gz
        fi

        rm -rf "$runtime_samples_dir/bin" "$runtime_samples_dir/config"
        ln -sfn "$source_samples_dir/bin" "$runtime_samples_dir/bin"
        ln -sfn "$source_samples_dir/config" "$runtime_samples_dir/config"
        if [[ -d "$source_samples_dir/builders" ]]; then
            rm -rf "$runtime_samples_dir/builders"
            ln -sfn "$source_samples_dir/builders" "$runtime_samples_dir/builders"
        fi
    fi

    fabric_apply_runtime_network_overrides "$runtime_test_network"
    fabric_apply_runtime_version_overrides "$runtime_samples_dir" "$runtime_test_network"
    fabric_patch_network_cleanup "$runtime_test_network"

    export FABRIC_SAMPLES_SOURCE_DIR="$source_samples_dir"
    export FABRIC_SAMPLES_DIR="$runtime_samples_dir"
    export FABRIC_DIR="$runtime_test_network"
    export FABRIC_BIN_DIR="$runtime_samples_dir/bin"
    export FABRIC_CONFIG_DIR="$runtime_samples_dir/config"
    export FABRIC_CRYPTO_PATH="$runtime_test_network/organizations/peerOrganizations/org1.example.com"
    export FABRIC_PEER_BIN="$runtime_samples_dir/bin/peer"
    return 0
}
