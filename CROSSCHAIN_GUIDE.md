# 跨链互通操作指南（傻瓜式）

## 目标
本文档提供当前项目的**最简启动与验证流程**，目标是：
- 一条命令启动核心服务
- 一条命令完成双向跨链验收
- WSL 崩溃后可快速恢复

---

## 0. 前置要求
- 已安装并启动 Docker Desktop
- WSL 环境可访问项目目录 /home/tr/projects/cross-chain
- Fabric/FISCO 基础依赖已按项目初始化完成

---

## 1. 一键启动（推荐）
在项目根目录执行：

=========================================
  跨链系统一键启动
=========================================
SKIP_FISCO: false
SKIP_FABRIC: false
SKIP_DEPLOY_CC: false
FAST_MODE: false
NO_DOWN: false
=========================================

[1/3] 启动 FISCO-BCOS 节点...
停止旧的 FISCO 节点...
try to stop node0
[32m stop node0 success.[0m
try to stop node1
[32m stop node1 success.[0m
try to stop node2
[32m stop node2 success.[0m
try to stop node3
[32m stop node3 success.[0m
启动 FISCO 节点...
try to start node0
try to start node1
try to start node2
try to start node3
[32m node0 start successfully pid=64719[0m
[32m node3 start successfully pid=64730[0m
[32m node2 start successfully pid=64725[0m
[32m node1 start successfully pid=64728[0m
✓ FISCO-BCOS 启动成功

[2/3] 启动 Hyperledger Fabric 网络...
清理旧的 Fabric 网络...
[0;34mUsing docker and docker-compose[0m
[0;34mStopping network[0m
[0;34mRemoving remaining containers[0m
[0;34mRemoving generated chaincode docker images[0m
Untagged: dev-peer0.org2.example.com-gateway_cc_1.0-6ae9bbeafed2eafbb04579ad1417aeabe9cef3dafd7243f06f6dac719e5a6c4c-f1cbeca99054327b15cf12062143a7c3060887c0be88557b3d56c93bd38b2b3b:latest
Deleted: sha256:a26973dd410a6ed0f1428594795aa2c139c9c0080efbae5e168082b21c69fb6e
Deleted: sha256:1eee0a0b0a2c056b7b5eafb9c3e6c0b04cc38ac9d9f8eb57e150bdadcdc2bd6b
Deleted: sha256:8f43d36f4f48d07323b285fa94ede198d508546f3f63d96e4bd0b4e04c8ce849
Deleted: sha256:0509f24b40a40a6b4116234cde870f273426478a988fe24c95772dd355a81f15
Untagged: dev-peer0.org1.example.com-gateway_cc_1.0-6ae9bbeafed2eafbb04579ad1417aeabe9cef3dafd7243f06f6dac719e5a6c4c-26e49e7b595c51cebb9965c5c38b6044d896778fca2b1e97d403257fcaf025e2:latest
Deleted: sha256:3422cd952864ce0b5d66e38bc936e0f0a070d5c2d52a19a757f737d1f058cd75
Deleted: sha256:b7b7891b1acdb3b98d738f843eed5bc74b3b16af629391f6b79175cbcd5967c2
Deleted: sha256:fe3de246e19df236ccf6e4aede1c58b715bbbefcb192fe334558f6862e448880
Deleted: sha256:8cc586c4d5ee00aad9138492f1a8b9c4b76ff634ac6bb6f84b293d3fcce8a94c
启动/复用 Fabric 网络...
[0;34mUsing docker and docker-compose[0m
[0;34mStarting nodes with CLI timeout of '5' tries and CLI delay of '3' seconds and using database 'couchdb' with crypto from 'Certificate Authorities'[0m
[0;34mLOCAL_VERSION=v2.5.14[0m
[0;34mDOCKER_IMAGE_VERSION=v3.1.3[0m
[1;33mLocal fabric binaries and docker images are out of sync. This may cause problems.[0m
[0;34mCA_LOCAL_VERSION=v1.5.15[0m
[0;34mCA_DOCKER_IMAGE_VERSION=v1.5.16[0m
[1;33mLocal fabric-ca binaries and docker images are out of sync. This may cause problems.[0m
[0;34mGenerating certificates using Fabric CA[0m
 Network fabric_test  Creating
 Network fabric_test  Created
 Container ca_org1  Creating
 Container ca_orderer  Creating
 Container ca_org2  Creating
 Container ca_orderer  Created
 Container ca_org1  Created
 Container ca_org2  Created
 Container ca_orderer  Starting
 Container ca_org1  Starting
 Container ca_org2  Starting
 Container ca_org1  Started
 Container ca_org2  Started
 Container ca_orderer  Started
+ fabric-ca-client getcainfo -u https://admin:adminpw@localhost:7054 --caname ca-org1 --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:22 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:22 [INFO] TLS Enabled
2026/02/07 00:22:22 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:22:22 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/IssuerPublicKey
2026/02/07 00:22:22 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/IssuerRevocationPublicKey
+ res=0
[0;34mCreating Org1 Identities[0m
[0;34mEnrolling the CA admin[0m
+ fabric-ca-client enroll -u https://admin:adminpw@localhost:7054 --caname ca-org1 --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:22 [INFO] Created a default configuration file at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:22 [INFO] TLS Enabled
2026/02/07 00:22:22 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:22 [INFO] encoded CSR
2026/02/07 00:22:22 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:22 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:22:22 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/IssuerPublicKey
2026/02/07 00:22:22 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/IssuerRevocationPublicKey
[0;34mRegistering peer0[0m
+ fabric-ca-client register --caname ca-org1 --id.name peer0 --id.secret peer0pw --id.type peer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:22 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:22 [INFO] TLS Enabled
2026/02/07 00:22:22 [INFO] TLS Enabled
Password: peer0pw
[0;34mRegistering user[0m
+ fabric-ca-client register --caname ca-org1 --id.name user1 --id.secret user1pw --id.type client --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:23 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:23 [INFO] TLS Enabled
2026/02/07 00:22:23 [INFO] TLS Enabled
Password: user1pw
[0;34mRegistering the org admin[0m
+ fabric-ca-client register --caname ca-org1 --id.name org1admin --id.secret org1adminpw --id.type admin --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:23 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:23 [INFO] TLS Enabled
2026/02/07 00:22:23 [INFO] TLS Enabled
Password: org1adminpw
[0;34mGenerating the peer0 msp[0m
+ fabric-ca-client enroll -u https://peer0:peer0pw@localhost:7054 --caname ca-org1 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:23 [INFO] TLS Enabled
2026/02/07 00:22:23 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:23 [INFO] encoded CSR
2026/02/07 00:22:23 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:23 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:22:23 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/IssuerPublicKey
2026/02/07 00:22:23 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the peer0-tls certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://peer0:peer0pw@localhost:7054 --caname ca-org1 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls --enrollment.profile tls --csr.hosts peer0.org1.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:23 [INFO] TLS Enabled
2026/02/07 00:22:23 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:23 [INFO] encoded CSR
2026/02/07 00:22:23 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/signcerts/cert.pem
2026/02/07 00:22:23 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/tlscacerts/tls-localhost-7054-ca-org1.pem
2026/02/07 00:22:23 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/IssuerPublicKey
2026/02/07 00:22:23 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/IssuerRevocationPublicKey
[0;34mGenerating the user msp[0m
+ fabric-ca-client enroll -u https://user1:user1pw@localhost:7054 --caname ca-org1 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:23 [INFO] TLS Enabled
2026/02/07 00:22:23 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:23 [INFO] encoded CSR
2026/02/07 00:22:23 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:23 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:22:23 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/IssuerPublicKey
2026/02/07 00:22:23 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the org admin msp[0m
+ fabric-ca-client enroll -u https://org1admin:org1adminpw@localhost:7054 --caname ca-org1 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:22:23 [INFO] TLS Enabled
2026/02/07 00:22:23 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:23 [INFO] encoded CSR
2026/02/07 00:22:23 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:23 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:22:23 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/IssuerPublicKey
2026/02/07 00:22:23 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/IssuerRevocationPublicKey
[0;34mCreating Org2 Identities[0m
[0;34mEnrolling the CA admin[0m
+ fabric-ca-client enroll -u https://admin:adminpw@localhost:8054 --caname ca-org2 --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:22:23 [INFO] Created a default configuration file at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:23 [INFO] TLS Enabled
2026/02/07 00:22:23 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:23 [INFO] encoded CSR
2026/02/07 00:22:23 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:23 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/msp/cacerts/localhost-8054-ca-org2.pem
2026/02/07 00:22:23 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/msp/IssuerPublicKey
2026/02/07 00:22:23 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/msp/IssuerRevocationPublicKey
[0;34mRegistering peer0[0m
+ fabric-ca-client register --caname ca-org2 --id.name peer0 --id.secret peer0pw --id.type peer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:22:23 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:23 [INFO] TLS Enabled
2026/02/07 00:22:23 [INFO] TLS Enabled
Password: peer0pw
[0;34mRegistering user[0m
+ fabric-ca-client register --caname ca-org2 --id.name user1 --id.secret user1pw --id.type client --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:22:24 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:24 [INFO] TLS Enabled
2026/02/07 00:22:24 [INFO] TLS Enabled
Password: user1pw
[0;34mRegistering the org admin[0m
+ fabric-ca-client register --caname ca-org2 --id.name org2admin --id.secret org2adminpw --id.type admin --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:22:24 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:24 [INFO] TLS Enabled
2026/02/07 00:22:24 [INFO] TLS Enabled
Password: org2adminpw
[0;34mGenerating the peer0 msp[0m
+ fabric-ca-client enroll -u https://peer0:peer0pw@localhost:8054 --caname ca-org2 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:22:24 [INFO] TLS Enabled
2026/02/07 00:22:24 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:24 [INFO] encoded CSR
2026/02/07 00:22:24 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:24 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/cacerts/localhost-8054-ca-org2.pem
2026/02/07 00:22:24 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/IssuerPublicKey
2026/02/07 00:22:24 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the peer0-tls certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://peer0:peer0pw@localhost:8054 --caname ca-org2 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls --enrollment.profile tls --csr.hosts peer0.org2.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:22:24 [INFO] TLS Enabled
2026/02/07 00:22:24 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:24 [INFO] encoded CSR
2026/02/07 00:22:24 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/signcerts/cert.pem
2026/02/07 00:22:24 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/tlscacerts/tls-localhost-8054-ca-org2.pem
2026/02/07 00:22:24 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/IssuerPublicKey
2026/02/07 00:22:24 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/IssuerRevocationPublicKey
[0;34mGenerating the user msp[0m
+ fabric-ca-client enroll -u https://user1:user1pw@localhost:8054 --caname ca-org2 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:22:24 [INFO] TLS Enabled
2026/02/07 00:22:24 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:24 [INFO] encoded CSR
2026/02/07 00:22:24 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:24 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp/cacerts/localhost-8054-ca-org2.pem
2026/02/07 00:22:24 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp/IssuerPublicKey
2026/02/07 00:22:24 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the org admin msp[0m
+ fabric-ca-client enroll -u https://org2admin:org2adminpw@localhost:8054 --caname ca-org2 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:22:24 [INFO] TLS Enabled
2026/02/07 00:22:24 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:24 [INFO] encoded CSR
2026/02/07 00:22:24 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:24 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/cacerts/localhost-8054-ca-org2.pem
2026/02/07 00:22:24 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/IssuerPublicKey
2026/02/07 00:22:24 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/IssuerRevocationPublicKey
[0;34mCreating Orderer Org Identities[0m
[0;34mEnrolling the CA admin[0m
+ fabric-ca-client enroll -u https://admin:adminpw@localhost:9054 --caname ca-orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:25 [INFO] Created a default configuration file at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:25 [INFO] TLS Enabled
2026/02/07 00:22:25 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:25 [INFO] encoded CSR
2026/02/07 00:22:25 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/msp/signcerts/cert.pem
2026/02/07 00:22:25 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:22:25 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/msp/IssuerPublicKey
2026/02/07 00:22:25 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/msp/IssuerRevocationPublicKey
[0;34mRegistering orderer[0m
+ fabric-ca-client register --caname ca-orderer --id.name orderer --id.secret ordererpw --id.type orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:25 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:25 [INFO] TLS Enabled
2026/02/07 00:22:25 [INFO] TLS Enabled
Password: ordererpw
[0;34mGenerating the orderer MSP[0m
+ fabric-ca-client enroll -u https://orderer:ordererpw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:25 [INFO] TLS Enabled
2026/02/07 00:22:25 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:25 [INFO] encoded CSR
2026/02/07 00:22:25 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:25 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:22:25 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/IssuerPublicKey
2026/02/07 00:22:25 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the orderer TLS certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://orderer:ordererpw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls --enrollment.profile tls --csr.hosts orderer.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:25 [INFO] TLS Enabled
2026/02/07 00:22:25 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:25 [INFO] encoded CSR
2026/02/07 00:22:25 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/signcerts/cert.pem
2026/02/07 00:22:25 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/tlscacerts/tls-localhost-9054-ca-orderer.pem
2026/02/07 00:22:25 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/IssuerPublicKey
2026/02/07 00:22:25 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/IssuerRevocationPublicKey
[0;34mRegistering orderer2[0m
+ fabric-ca-client register --caname ca-orderer --id.name orderer2 --id.secret orderer2pw --id.type orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:25 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:25 [INFO] TLS Enabled
2026/02/07 00:22:25 [INFO] TLS Enabled
Password: orderer2pw
[0;34mGenerating the orderer2 MSP[0m
+ fabric-ca-client enroll -u https://orderer2:orderer2pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:25 [INFO] TLS Enabled
2026/02/07 00:22:25 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:25 [INFO] encoded CSR
2026/02/07 00:22:25 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:25 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:22:25 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp/IssuerPublicKey
2026/02/07 00:22:25 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the orderer2 TLS certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://orderer2:orderer2pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls --enrollment.profile tls --csr.hosts orderer2.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:26 [INFO] TLS Enabled
2026/02/07 00:22:26 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:26 [INFO] encoded CSR
2026/02/07 00:22:26 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls/signcerts/cert.pem
2026/02/07 00:22:26 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls/tlscacerts/tls-localhost-9054-ca-orderer.pem
2026/02/07 00:22:26 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls/IssuerPublicKey
2026/02/07 00:22:26 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls/IssuerRevocationPublicKey
[0;34mRegistering orderer3[0m
+ fabric-ca-client register --caname ca-orderer --id.name orderer3 --id.secret orderer3pw --id.type orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:26 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:26 [INFO] TLS Enabled
2026/02/07 00:22:26 [INFO] TLS Enabled
Password: orderer3pw
[0;34mGenerating the orderer3 MSP[0m
+ fabric-ca-client enroll -u https://orderer3:orderer3pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:26 [INFO] TLS Enabled
2026/02/07 00:22:26 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:26 [INFO] encoded CSR
2026/02/07 00:22:26 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:26 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:22:26 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp/IssuerPublicKey
2026/02/07 00:22:26 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the orderer3 TLS certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://orderer3:orderer3pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls --enrollment.profile tls --csr.hosts orderer3.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:26 [INFO] TLS Enabled
2026/02/07 00:22:26 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:26 [INFO] encoded CSR
2026/02/07 00:22:26 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls/signcerts/cert.pem
2026/02/07 00:22:26 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls/tlscacerts/tls-localhost-9054-ca-orderer.pem
2026/02/07 00:22:26 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls/IssuerPublicKey
2026/02/07 00:22:26 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls/IssuerRevocationPublicKey
[0;34mRegistering orderer4[0m
+ fabric-ca-client register --caname ca-orderer --id.name orderer4 --id.secret orderer4pw --id.type orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:26 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:26 [INFO] TLS Enabled
2026/02/07 00:22:26 [INFO] TLS Enabled
Password: orderer4pw
[0;34mGenerating the orderer4 MSP[0m
+ fabric-ca-client enroll -u https://orderer4:orderer4pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:26 [INFO] TLS Enabled
2026/02/07 00:22:26 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:26 [INFO] encoded CSR
2026/02/07 00:22:26 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp/signcerts/cert.pem
2026/02/07 00:22:26 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:22:26 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp/IssuerPublicKey
2026/02/07 00:22:26 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the orderer4 TLS certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://orderer4:orderer4pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls --enrollment.profile tls --csr.hosts orderer4.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:26 [INFO] TLS Enabled
2026/02/07 00:22:26 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:26 [INFO] encoded CSR
2026/02/07 00:22:27 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls/signcerts/cert.pem
2026/02/07 00:22:27 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls/tlscacerts/tls-localhost-9054-ca-orderer.pem
2026/02/07 00:22:27 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls/IssuerPublicKey
2026/02/07 00:22:27 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls/IssuerRevocationPublicKey
[0;34mRegistering the orderer admin[0m
+ fabric-ca-client register --caname ca-orderer --id.name ordererAdmin --id.secret ordererAdminpw --id.type admin --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:27 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:22:27 [INFO] TLS Enabled
2026/02/07 00:22:27 [INFO] TLS Enabled
Password: ordererAdminpw
[0;34mGenerating the admin msp[0m
+ fabric-ca-client enroll -u https://ordererAdmin:ordererAdminpw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:22:27 [INFO] TLS Enabled
2026/02/07 00:22:27 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:22:27 [INFO] encoded CSR
2026/02/07 00:22:27 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp/signcerts/cert.pem
2026/02/07 00:22:27 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:22:27 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp/IssuerPublicKey
2026/02/07 00:22:27 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating CCP files for Org1 and Org2[0m
 Volume "compose_peer0.org2.example.com"  Creating
 Volume "compose_peer0.org2.example.com"  Created
 Volume "compose_orderer.example.com"  Creating
 Volume "compose_orderer.example.com"  Created
 Volume "compose_peer0.org1.example.com"  Creating
 Volume "compose_peer0.org1.example.com"  Created
time="2026-02-07T00:22:27+08:00" level=warning msg="Found orphan containers ([ca_org1 ca_org2 ca_orderer]) for this project. If you removed or renamed this service in your compose file, you can run this command with the --remove-orphans flag to clean it up."
 Container orderer.example.com  Creating
 Container couchdb0  Creating
 Container couchdb1  Creating
 Container couchdb0  Created
 Container peer0.org1.example.com  Creating
 Container couchdb1  Created
 Container peer0.org2.example.com  Creating
 Container orderer.example.com  Created
 Container peer0.org1.example.com  Created
 Container peer0.org2.example.com  Created
 Container orderer.example.com  Starting
 Container couchdb1  Starting
 Container couchdb0  Starting
 Container couchdb0  Started
 Container peer0.org1.example.com  Starting
 Container couchdb1  Started
 Container peer0.org2.example.com  Starting
 Container orderer.example.com  Started
 Container peer0.org2.example.com  Started
 Container peer0.org1.example.com  Started
CONTAINER ID   IMAGE                               COMMAND                  CREATED         STATUS                  PORTS                                                                    NAMES
ecfc194f483a   hyperledger/fabric-peer:latest      "peer node start"        1 second ago    Up Less than a second   0.0.0.0:9051->9051/tcp, 7051/tcp, 0.0.0.0:9445->9445/tcp                 peer0.org2.example.com
a29b8a6753ed   hyperledger/fabric-peer:latest      "peer node start"        1 second ago    Up Less than a second   0.0.0.0:7051->7051/tcp, 0.0.0.0:9444->9444/tcp                           peer0.org1.example.com
45b387bbad77   hyperledger/fabric-orderer:latest   "orderer"                1 second ago    Up Less than a second   0.0.0.0:7050->7050/tcp, 0.0.0.0:7053->7053/tcp, 0.0.0.0:9443->9443/tcp   orderer.example.com
c8c13a96ec47   couchdb:3.4.2                       "tini -- /docker-ent…"   1 second ago    Up Less than a second   4369/tcp, 9100/tcp, 0.0.0.0:7984->5984/tcp                               couchdb1
c801d90c39db   couchdb:3.4.2                       "tini -- /docker-ent…"   1 second ago    Up Less than a second   4369/tcp, 9100/tcp, 0.0.0.0:5984->5984/tcp                               couchdb0
a2a10e31ffbc   hyperledger/fabric-ca:latest        "sh -c 'fabric-ca-se…"   9 seconds ago   Up 8 seconds            0.0.0.0:7054->7054/tcp, 0.0.0.0:17054->17054/tcp                         ca_org1
dffedcea2a21   hyperledger/fabric-ca:latest        "sh -c 'fabric-ca-se…"   9 seconds ago   Up 8 seconds            0.0.0.0:8054->8054/tcp, 7054/tcp, 0.0.0.0:18054->18054/tcp               ca_org2
681b057dae51   hyperledger/fabric-ca:latest        "sh -c 'fabric-ca-se…"   9 seconds ago   Up 8 seconds            0.0.0.0:9054->9054/tcp, 7054/tcp, 0.0.0.0:19054->19054/tcp               ca_orderer
创建 Fabric 通道 mychannel...
✓ Fabric 网络启动成功

[3/3] 部署合约和 Chaincode...
=========================================
Bootstrap Script - 自动部署合约
=========================================
REDEPLOY_FISCO: true
RECEIVE_METHOD: receiveLite
SKIP_FABRIC_CC: false
SKIP_FISCO_CONTRACTS: false
=========================================

[1/3] 部署 FISCO 合约...
开始部署 FISCO 合约...
0x8a5c9b06e2d86b43c8a82bd1091d11c1da893139
0xf9b5666f01a9fd6e93093360ec17e9ddb85628ae
0xab6f2a90671fa1b244cd0b3fd8adc3ff22759d06

start-all.sh 当前能力：
- 启动 FISCO 节点
- 启动/复用 Fabric test-network
- 自动处理 Fabric 通道已存在场景（避免重复 join 报错）
- 自动部署/更新 FISCO 合约
- 自动部署 Fabric gateway_cc（可按参数跳过）
- 自动更新 abric-chaincode/Relayer/config.json

常用参数：

=========================================
  跨链系统一键启动
=========================================
SKIP_FISCO: false
SKIP_FABRIC: false
SKIP_DEPLOY_CC: false
FAST_MODE: true
NO_DOWN: false
=========================================

[1/3] 启动 FISCO-BCOS 节点...
启动 FISCO 节点...
try to start node0
try to start node1
try to start node2
try to start node3
[31m  Exceed waiting time. Please try again to start node0 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-06 23:23:48] The fisco-bcos is running...
[2026-02-07 00:21:48] exit because receive signal 15
[2026-02-07 00:21:49] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:21:55] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:22:52] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[31m  Exceed waiting time. Please try again to start node2 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-06 23:23:48] The fisco-bcos is running...
[2026-02-07 00:21:51] exit because receive signal 15
[2026-02-07 00:21:51] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:21:55] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:22:52] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[31m  Exceed waiting time. Please try again to start node1 [0m
[31m  Exceed waiting time. Please try again to start node3 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-06 23:23:48] The fisco-bcos is running...
[2026-02-07 00:21:52] exit because receive signal 15
[2026-02-07 00:21:52] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:21:55] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:22:52] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-06 23:23:48] The fisco-bcos is running...
[2026-02-07 00:21:50] exit because receive signal 15
[2026-02-07 00:21:50] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:21:55] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:22:52] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

✗ FISCO-BCOS 启动失败
=========================================
  跨链系统一键启动
=========================================
SKIP_FISCO: false
SKIP_FABRIC: false
SKIP_DEPLOY_CC: false
FAST_MODE: false
NO_DOWN: true
=========================================

[1/3] 启动 FISCO-BCOS 节点...
停止旧的 FISCO 节点...
try to stop node0
[32m stop node0 success.[0m
try to stop node1
[32m stop node1 success.[0m
try to stop node2
[32m stop node2 success.[0m
try to stop node3
[32m stop node3 success.[0m
启动 FISCO 节点...
try to start node0
try to start node1
try to start node2
try to start node3
[31m  Exceed waiting time. Please try again to start node1 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:21:55] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:22:52] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[2026-02-07 00:23:04] exit because receive signal 15
[2026-02-07 00:23:04] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[31m  Exceed waiting time. Please try again to start node2 [0m
[31m  Exceed waiting time. Please try again to start node0 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:21:55] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:22:52] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[2026-02-07 00:23:05] exit because receive signal 15
[2026-02-07 00:23:05] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[31m  Exceed waiting time. Please try again to start node3 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:21:55] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:22:52] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[2026-02-07 00:23:02] exit because receive signal 15
[2026-02-07 00:23:03] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:21:55] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:22:52] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[2026-02-07 00:23:06] exit because receive signal 15
[2026-02-07 00:23:06] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
✗ FISCO-BCOS 启动失败
=========================================
  跨链系统一键启动
=========================================
SKIP_FISCO: false
SKIP_FABRIC: true
SKIP_DEPLOY_CC: false
FAST_MODE: false
NO_DOWN: false
=========================================

[1/3] 启动 FISCO-BCOS 节点...
停止旧的 FISCO 节点...
try to stop node0
[32m stop node0 success.[0m
try to stop node1
[32m stop node1 success.[0m
try to stop node2
[32m stop node2 success.[0m
try to stop node3
[32m stop node3 success.[0m
启动 FISCO 节点...
try to start node0
try to start node1
try to start node2
try to start node3
[31m  Exceed waiting time. Please try again to start node1 [0m
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[2026-02-07 00:23:04] exit because receive signal 15
[2026-02-07 00:23:04] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[2026-02-07 00:23:20] exit because receive signal 15
[2026-02-07 00:23:20] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:26] The fisco-bcos is running...
[31m  Exceed waiting time. Please try again to start node2 [0m
[31m  Exceed waiting time. Please try again to start node3 [0m
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[2026-02-07 00:23:05] exit because receive signal 15
[2026-02-07 00:23:05] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[2026-02-07 00:23:21] exit because receive signal 15
[2026-02-07 00:23:21] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:26] The fisco-bcos is running...
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[2026-02-07 00:23:06] exit because receive signal 15
[2026-02-07 00:23:06] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[2026-02-07 00:23:22] exit because receive signal 15
[2026-02-07 00:23:22] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:26] The fisco-bcos is running...
[31m  Exceed waiting time. Please try again to start node0 [0m
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[2026-02-07 00:23:02] exit because receive signal 15
[2026-02-07 00:23:03] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[2026-02-07 00:23:19] exit because receive signal 15
[2026-02-07 00:23:19] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:26] The fisco-bcos is running...
✗ FISCO-BCOS 启动失败
=========================================
  跨链系统一键启动
=========================================
SKIP_FISCO: true
SKIP_FABRIC: false
SKIP_DEPLOY_CC: false
FAST_MODE: false
NO_DOWN: false
=========================================
[1/3] 跳过 FISCO 启动

[2/3] 启动 Hyperledger Fabric 网络...
清理旧的 Fabric 网络...
[0;34mUsing docker and docker-compose[0m
[0;34mStopping network[0m
[0;34mRemoving remaining containers[0m
[0;34mRemoving generated chaincode docker images[0m
启动/复用 Fabric 网络...
[0;34mUsing docker and docker-compose[0m
[0;34mStarting nodes with CLI timeout of '5' tries and CLI delay of '3' seconds and using database 'couchdb' with crypto from 'Certificate Authorities'[0m
[0;34mLOCAL_VERSION=v2.5.14[0m
[0;34mDOCKER_IMAGE_VERSION=v3.1.3[0m
[1;33mLocal fabric binaries and docker images are out of sync. This may cause problems.[0m
[0;34mCA_LOCAL_VERSION=v1.5.15[0m
[0;34mCA_DOCKER_IMAGE_VERSION=v1.5.16[0m
[1;33mLocal fabric-ca binaries and docker images are out of sync. This may cause problems.[0m
[0;34mGenerating certificates using Fabric CA[0m
 Network fabric_test  Creating
 Network fabric_test  Created
 Container ca_org1  Creating
 Container ca_org2  Creating
 Container ca_orderer  Creating
 Container ca_org1  Created
 Container ca_orderer  Created
 Container ca_org2  Created
 Container ca_orderer  Starting
 Container ca_org1  Starting
 Container ca_org2  Starting
 Container ca_org2  Started
 Container ca_org1  Started
 Container ca_orderer  Started
+ fabric-ca-client getcainfo -u https://admin:adminpw@localhost:7054 --caname ca-org1 --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:56 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:56 [INFO] TLS Enabled
2026/02/07 00:23:56 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:23:56 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/IssuerPublicKey
2026/02/07 00:23:56 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/IssuerRevocationPublicKey
+ res=0
[0;34mCreating Org1 Identities[0m
[0;34mEnrolling the CA admin[0m
+ fabric-ca-client enroll -u https://admin:adminpw@localhost:7054 --caname ca-org1 --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:56 [INFO] Created a default configuration file at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:56 [INFO] TLS Enabled
2026/02/07 00:23:56 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:56 [INFO] encoded CSR
2026/02/07 00:23:56 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:56 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:23:56 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/IssuerPublicKey
2026/02/07 00:23:56 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/msp/IssuerRevocationPublicKey
[0;34mRegistering peer0[0m
+ fabric-ca-client register --caname ca-org1 --id.name peer0 --id.secret peer0pw --id.type peer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:56 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:56 [INFO] TLS Enabled
2026/02/07 00:23:56 [INFO] TLS Enabled
Password: peer0pw
[0;34mRegistering user[0m
+ fabric-ca-client register --caname ca-org1 --id.name user1 --id.secret user1pw --id.type client --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:57 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:57 [INFO] TLS Enabled
2026/02/07 00:23:57 [INFO] TLS Enabled
Password: user1pw
[0;34mRegistering the org admin[0m
+ fabric-ca-client register --caname ca-org1 --id.name org1admin --id.secret org1adminpw --id.type admin --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:57 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:57 [INFO] TLS Enabled
2026/02/07 00:23:57 [INFO] TLS Enabled
Password: org1adminpw
[0;34mGenerating the peer0 msp[0m
+ fabric-ca-client enroll -u https://peer0:peer0pw@localhost:7054 --caname ca-org1 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:57 [INFO] TLS Enabled
2026/02/07 00:23:57 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:57 [INFO] encoded CSR
2026/02/07 00:23:57 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:57 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:23:57 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/IssuerPublicKey
2026/02/07 00:23:57 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the peer0-tls certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://peer0:peer0pw@localhost:7054 --caname ca-org1 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls --enrollment.profile tls --csr.hosts peer0.org1.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:57 [INFO] TLS Enabled
2026/02/07 00:23:57 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:57 [INFO] encoded CSR
2026/02/07 00:23:57 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/signcerts/cert.pem
2026/02/07 00:23:57 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/tlscacerts/tls-localhost-7054-ca-org1.pem
2026/02/07 00:23:57 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/IssuerPublicKey
2026/02/07 00:23:57 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/IssuerRevocationPublicKey
[0;34mGenerating the user msp[0m
+ fabric-ca-client enroll -u https://user1:user1pw@localhost:7054 --caname ca-org1 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:57 [INFO] TLS Enabled
2026/02/07 00:23:57 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:57 [INFO] encoded CSR
2026/02/07 00:23:57 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:57 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:23:57 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/IssuerPublicKey
2026/02/07 00:23:57 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the org admin msp[0m
+ fabric-ca-client enroll -u https://org1admin:org1adminpw@localhost:7054 --caname ca-org1 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem
2026/02/07 00:23:57 [INFO] TLS Enabled
2026/02/07 00:23:57 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:57 [INFO] encoded CSR
2026/02/07 00:23:57 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:57 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/cacerts/localhost-7054-ca-org1.pem
2026/02/07 00:23:57 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/IssuerPublicKey
2026/02/07 00:23:57 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/IssuerRevocationPublicKey
[0;34mCreating Org2 Identities[0m
[0;34mEnrolling the CA admin[0m
+ fabric-ca-client enroll -u https://admin:adminpw@localhost:8054 --caname ca-org2 --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:23:57 [INFO] Created a default configuration file at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:57 [INFO] TLS Enabled
2026/02/07 00:23:57 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:57 [INFO] encoded CSR
2026/02/07 00:23:57 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:57 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/msp/cacerts/localhost-8054-ca-org2.pem
2026/02/07 00:23:57 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/msp/IssuerPublicKey
2026/02/07 00:23:57 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/msp/IssuerRevocationPublicKey
[0;34mRegistering peer0[0m
+ fabric-ca-client register --caname ca-org2 --id.name peer0 --id.secret peer0pw --id.type peer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:23:57 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:57 [INFO] TLS Enabled
2026/02/07 00:23:57 [INFO] TLS Enabled
Password: peer0pw
[0;34mRegistering user[0m
+ fabric-ca-client register --caname ca-org2 --id.name user1 --id.secret user1pw --id.type client --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:23:58 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:58 [INFO] TLS Enabled
2026/02/07 00:23:58 [INFO] TLS Enabled
Password: user1pw
[0;34mRegistering the org admin[0m
+ fabric-ca-client register --caname ca-org2 --id.name org2admin --id.secret org2adminpw --id.type admin --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:23:58 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:58 [INFO] TLS Enabled
2026/02/07 00:23:58 [INFO] TLS Enabled
Password: org2adminpw
[0;34mGenerating the peer0 msp[0m
+ fabric-ca-client enroll -u https://peer0:peer0pw@localhost:8054 --caname ca-org2 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:23:58 [INFO] TLS Enabled
2026/02/07 00:23:58 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:58 [INFO] encoded CSR
2026/02/07 00:23:58 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:58 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/cacerts/localhost-8054-ca-org2.pem
2026/02/07 00:23:58 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/IssuerPublicKey
2026/02/07 00:23:58 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the peer0-tls certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://peer0:peer0pw@localhost:8054 --caname ca-org2 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls --enrollment.profile tls --csr.hosts peer0.org2.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:23:58 [INFO] TLS Enabled
2026/02/07 00:23:58 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:58 [INFO] encoded CSR
2026/02/07 00:23:58 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/signcerts/cert.pem
2026/02/07 00:23:58 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/tlscacerts/tls-localhost-8054-ca-org2.pem
2026/02/07 00:23:58 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/IssuerPublicKey
2026/02/07 00:23:58 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/IssuerRevocationPublicKey
[0;34mGenerating the user msp[0m
+ fabric-ca-client enroll -u https://user1:user1pw@localhost:8054 --caname ca-org2 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:23:58 [INFO] TLS Enabled
2026/02/07 00:23:58 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:58 [INFO] encoded CSR
2026/02/07 00:23:58 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:58 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp/cacerts/localhost-8054-ca-org2.pem
2026/02/07 00:23:58 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp/IssuerPublicKey
2026/02/07 00:23:58 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/User1@org2.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the org admin msp[0m
+ fabric-ca-client enroll -u https://org2admin:org2adminpw@localhost:8054 --caname ca-org2 -M /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/org2/ca-cert.pem
2026/02/07 00:23:58 [INFO] TLS Enabled
2026/02/07 00:23:58 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:58 [INFO] encoded CSR
2026/02/07 00:23:58 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:58 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/cacerts/localhost-8054-ca-org2.pem
2026/02/07 00:23:58 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/IssuerPublicKey
2026/02/07 00:23:58 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/IssuerRevocationPublicKey
[0;34mCreating Orderer Org Identities[0m
[0;34mEnrolling the CA admin[0m
+ fabric-ca-client enroll -u https://admin:adminpw@localhost:9054 --caname ca-orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:23:58 [INFO] Created a default configuration file at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:58 [INFO] TLS Enabled
2026/02/07 00:23:58 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:58 [INFO] encoded CSR
2026/02/07 00:23:59 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/msp/signcerts/cert.pem
2026/02/07 00:23:59 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:23:59 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/msp/IssuerPublicKey
2026/02/07 00:23:59 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/msp/IssuerRevocationPublicKey
[0;34mRegistering orderer[0m
+ fabric-ca-client register --caname ca-orderer --id.name orderer --id.secret ordererpw --id.type orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:23:59 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:59 [INFO] TLS Enabled
2026/02/07 00:23:59 [INFO] TLS Enabled
Password: ordererpw
[0;34mGenerating the orderer MSP[0m
+ fabric-ca-client enroll -u https://orderer:ordererpw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:23:59 [INFO] TLS Enabled
2026/02/07 00:23:59 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:59 [INFO] encoded CSR
2026/02/07 00:23:59 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:59 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:23:59 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/IssuerPublicKey
2026/02/07 00:23:59 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the orderer TLS certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://orderer:ordererpw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls --enrollment.profile tls --csr.hosts orderer.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:23:59 [INFO] TLS Enabled
2026/02/07 00:23:59 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:59 [INFO] encoded CSR
2026/02/07 00:23:59 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/signcerts/cert.pem
2026/02/07 00:23:59 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/tlscacerts/tls-localhost-9054-ca-orderer.pem
2026/02/07 00:23:59 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/IssuerPublicKey
2026/02/07 00:23:59 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/IssuerRevocationPublicKey
[0;34mRegistering orderer2[0m
+ fabric-ca-client register --caname ca-orderer --id.name orderer2 --id.secret orderer2pw --id.type orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:23:59 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:59 [INFO] TLS Enabled
2026/02/07 00:23:59 [INFO] TLS Enabled
Password: orderer2pw
[0;34mGenerating the orderer2 MSP[0m
+ fabric-ca-client enroll -u https://orderer2:orderer2pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:23:59 [INFO] TLS Enabled
2026/02/07 00:23:59 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:59 [INFO] encoded CSR
2026/02/07 00:23:59 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp/signcerts/cert.pem
2026/02/07 00:23:59 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:23:59 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp/IssuerPublicKey
2026/02/07 00:23:59 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the orderer2 TLS certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://orderer2:orderer2pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls --enrollment.profile tls --csr.hosts orderer2.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:23:59 [INFO] TLS Enabled
2026/02/07 00:23:59 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:23:59 [INFO] encoded CSR
2026/02/07 00:23:59 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls/signcerts/cert.pem
2026/02/07 00:23:59 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls/tlscacerts/tls-localhost-9054-ca-orderer.pem
2026/02/07 00:23:59 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls/IssuerPublicKey
2026/02/07 00:23:59 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer2.example.com/tls/IssuerRevocationPublicKey
[0;34mRegistering orderer3[0m
+ fabric-ca-client register --caname ca-orderer --id.name orderer3 --id.secret orderer3pw --id.type orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:23:59 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:23:59 [INFO] TLS Enabled
2026/02/07 00:23:59 [INFO] TLS Enabled
Password: orderer3pw
[0;34mGenerating the orderer3 MSP[0m
+ fabric-ca-client enroll -u https://orderer3:orderer3pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:24:00 [INFO] TLS Enabled
2026/02/07 00:24:00 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:24:00 [INFO] encoded CSR
2026/02/07 00:24:00 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp/signcerts/cert.pem
2026/02/07 00:24:00 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:24:00 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp/IssuerPublicKey
2026/02/07 00:24:00 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the orderer3 TLS certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://orderer3:orderer3pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls --enrollment.profile tls --csr.hosts orderer3.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:24:00 [INFO] TLS Enabled
2026/02/07 00:24:00 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:24:00 [INFO] encoded CSR
2026/02/07 00:24:00 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls/signcerts/cert.pem
2026/02/07 00:24:00 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls/tlscacerts/tls-localhost-9054-ca-orderer.pem
2026/02/07 00:24:00 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls/IssuerPublicKey
2026/02/07 00:24:00 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer3.example.com/tls/IssuerRevocationPublicKey
[0;34mRegistering orderer4[0m
+ fabric-ca-client register --caname ca-orderer --id.name orderer4 --id.secret orderer4pw --id.type orderer --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:24:00 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:24:00 [INFO] TLS Enabled
2026/02/07 00:24:00 [INFO] TLS Enabled
Password: orderer4pw
[0;34mGenerating the orderer4 MSP[0m
+ fabric-ca-client enroll -u https://orderer4:orderer4pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:24:00 [INFO] TLS Enabled
2026/02/07 00:24:00 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:24:00 [INFO] encoded CSR
2026/02/07 00:24:00 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp/signcerts/cert.pem
2026/02/07 00:24:00 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:24:00 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp/IssuerPublicKey
2026/02/07 00:24:00 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating the orderer4 TLS certificates, use --csr.hosts to specify Subject Alternative Names[0m
+ fabric-ca-client enroll -u https://orderer4:orderer4pw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls --enrollment.profile tls --csr.hosts orderer4.example.com --csr.hosts localhost --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:24:00 [INFO] TLS Enabled
2026/02/07 00:24:00 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:24:00 [INFO] encoded CSR
2026/02/07 00:24:00 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls/signcerts/cert.pem
2026/02/07 00:24:00 [INFO] Stored TLS root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls/tlscacerts/tls-localhost-9054-ca-orderer.pem
2026/02/07 00:24:00 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls/IssuerPublicKey
2026/02/07 00:24:00 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer4.example.com/tls/IssuerRevocationPublicKey
[0;34mRegistering the orderer admin[0m
+ fabric-ca-client register --caname ca-orderer --id.name ordererAdmin --id.secret ordererAdminpw --id.type admin --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:24:00 [INFO] Configuration file location: /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/fabric-ca-client-config.yaml
2026/02/07 00:24:00 [INFO] TLS Enabled
2026/02/07 00:24:00 [INFO] TLS Enabled
Password: ordererAdminpw
[0;34mGenerating the admin msp[0m
+ fabric-ca-client enroll -u https://ordererAdmin:ordererAdminpw@localhost:9054 --caname ca-orderer -M /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp --tls.certfiles /home/tr/fabric-samples/test-network/organizations/fabric-ca/ordererOrg/ca-cert.pem
2026/02/07 00:24:00 [INFO] TLS Enabled
2026/02/07 00:24:00 [INFO] generating key: &{A:ecdsa S:256}
2026/02/07 00:24:00 [INFO] encoded CSR
2026/02/07 00:24:01 [INFO] Stored client certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp/signcerts/cert.pem
2026/02/07 00:24:01 [INFO] Stored root CA certificate at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp/cacerts/localhost-9054-ca-orderer.pem
2026/02/07 00:24:01 [INFO] Stored Issuer public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp/IssuerPublicKey
2026/02/07 00:24:01 [INFO] Stored Issuer revocation public key at /home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp/IssuerRevocationPublicKey
[0;34mGenerating CCP files for Org1 and Org2[0m
 Volume "compose_orderer.example.com"  Creating
 Volume "compose_orderer.example.com"  Created
 Volume "compose_peer0.org1.example.com"  Creating
 Volume "compose_peer0.org1.example.com"  Created
 Volume "compose_peer0.org2.example.com"  Creating
 Volume "compose_peer0.org2.example.com"  Created
time="2026-02-07T00:24:01+08:00" level=warning msg="Found orphan containers ([ca_orderer ca_org2 ca_org1]) for this project. If you removed or renamed this service in your compose file, you can run this command with the --remove-orphans flag to clean it up."
 Container couchdb0  Creating
 Container orderer.example.com  Creating
 Container couchdb1  Creating
 Container couchdb1  Created
 Container peer0.org2.example.com  Creating
 Container couchdb0  Created
 Container peer0.org1.example.com  Creating
 Container orderer.example.com  Created
 Container peer0.org1.example.com  Created
 Container peer0.org2.example.com  Created
 Container orderer.example.com  Starting
 Container couchdb1  Starting
 Container couchdb0  Starting
 Container couchdb0  Started
 Container peer0.org1.example.com  Starting
 Container orderer.example.com  Started
 Container couchdb1  Started
 Container peer0.org2.example.com  Starting
 Container peer0.org2.example.com  Started
 Container peer0.org1.example.com  Started
CONTAINER ID   IMAGE                               COMMAND                  CREATED         STATUS                  PORTS                                                                    NAMES
866e5b36dff3   hyperledger/fabric-peer:latest      "peer node start"        1 second ago    Up Less than a second   0.0.0.0:7051->7051/tcp, 0.0.0.0:9444->9444/tcp                           peer0.org1.example.com
1b09715808e6   hyperledger/fabric-peer:latest      "peer node start"        1 second ago    Up Less than a second   0.0.0.0:9051->9051/tcp, 7051/tcp, 0.0.0.0:9445->9445/tcp                 peer0.org2.example.com
28c311445b64   hyperledger/fabric-orderer:latest   "orderer"                1 second ago    Up Less than a second   0.0.0.0:7050->7050/tcp, 0.0.0.0:7053->7053/tcp, 0.0.0.0:9443->9443/tcp   orderer.example.com
6ab99021170a   couchdb:3.4.2                       "tini -- /docker-ent…"   1 second ago    Up Less than a second   4369/tcp, 9100/tcp, 0.0.0.0:7984->5984/tcp                               couchdb1
aed9fe101783   couchdb:3.4.2                       "tini -- /docker-ent…"   1 second ago    Up Less than a second   4369/tcp, 9100/tcp, 0.0.0.0:5984->5984/tcp                               couchdb0
5c69d2e8d471   hyperledger/fabric-ca:latest        "sh -c 'fabric-ca-se…"   9 seconds ago   Up 8 seconds            0.0.0.0:9054->9054/tcp, 7054/tcp, 0.0.0.0:19054->19054/tcp               ca_orderer
e6eeadd39d29   hyperledger/fabric-ca:latest        "sh -c 'fabric-ca-se…"   9 seconds ago   Up 8 seconds            0.0.0.0:8054->8054/tcp, 7054/tcp, 0.0.0.0:18054->18054/tcp               ca_org2
96992868d52d   hyperledger/fabric-ca:latest        "sh -c 'fabric-ca-se…"   9 seconds ago   Up 8 seconds            0.0.0.0:7054->7054/tcp, 0.0.0.0:17054->17054/tcp                         ca_org1
创建 Fabric 通道 mychannel...
✓ Fabric 网络启动成功

[3/3] 部署合约和 Chaincode...
=========================================
Bootstrap Script - 自动部署合约
=========================================
REDEPLOY_FISCO: true
RECEIVE_METHOD: receiveLite
SKIP_FABRIC_CC: false
SKIP_FISCO_CONTRACTS: false
=========================================

[1/3] 部署 FISCO 合约...
开始部署 FISCO 合约...
=========================================
  跨链系统一键启动
=========================================
SKIP_FISCO: false
SKIP_FABRIC: false
SKIP_DEPLOY_CC: true
FAST_MODE: false
NO_DOWN: false
=========================================

[1/3] 启动 FISCO-BCOS 节点...
停止旧的 FISCO 节点...
try to stop node0
[32m stop node0 success.[0m
try to stop node1
[32m stop node1 success.[0m
try to stop node2
[32m stop node2 success.[0m
try to stop node3
[32m stop node3 success.[0m
启动 FISCO 节点...
try to start node0
try to start node1
try to start node2
try to start node3
[31m  Exceed waiting time. Please try again to start node0 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[2026-02-07 00:23:19] exit because receive signal 15
[2026-02-07 00:23:19] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:26] The fisco-bcos is running...
[2026-02-07 00:24:15] exit because receive signal 15
[2026-02-07 00:24:15] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:24:22] The fisco-bcos is running...
[31m  Exceed waiting time. Please try again to start node1 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[2026-02-07 00:23:20] exit because receive signal 15
[2026-02-07 00:23:20] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:26] The fisco-bcos is running...
[2026-02-07 00:24:16] exit because receive signal 15
[2026-02-07 00:24:17] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:24:22] The fisco-bcos is running...
[31m  Exceed waiting time. Please try again to start node3 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[2026-02-07 00:23:22] exit because receive signal 15
[2026-02-07 00:23:22] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:26] The fisco-bcos is running...
[2026-02-07 00:24:18] exit because receive signal 15
[2026-02-07 00:24:19] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:24:22] The fisco-bcos is running...
[31m  Exceed waiting time. Please try again to start node2 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:09] The fisco-bcos is running...
[2026-02-07 00:23:21] exit because receive signal 15
[2026-02-07 00:23:21] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:23:26] The fisco-bcos is running...
[2026-02-07 00:24:17] exit because receive signal 15
[2026-02-07 00:24:18] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:24:22] The fisco-bcos is running...
✗ FISCO-BCOS 启动失败

---

## 2. 启动 Relayer（单独终端）


> crosschain-relayer@2.0.0 start
> node index.js

[Main] Loading configuration from: ./config.json
[Main] Starting CrossChain Relayer Service...
[Relayer] Initializing relay service...
[FabricMonitor] Initializing Fabric connection...
[FabricMonitor] Fabric connection initialized successfully
[Relayer] Initialized monitor for FABRIC_NET_01
[FiscoBcosMonitor] Initializing monitor for FISCO_NET_01
[FiscoBcosMonitor] Connecting to http://127.0.0.1:8545
[FiscoBcosMonitor] Connected! Current block: 130
[FiscoBcosMonitor] Gateway contract: 0x91d9ec991b3945baa9ca2f2790643a07ac677964
[FiscoBcosMonitor] Initialized, starting from block 130
[Relayer] Initialized monitor for FISCO_NET_01
[Relayer] Initialization complete
[Relayer] Starting relay service...
[FabricMonitor] Starting Fabric block monitoring...
[Relayer] Started monitoring FABRIC_NET_01
[FiscoBcosMonitor] Started monitoring FISCO_NET_01
[Relayer] Started monitoring FISCO_NET_01
[Relayer] Relay service started successfully
[Main] Relayer service is running
[Main] Shutting down...
[Relayer] Stopping relay service...
[FabricMonitor] Stopping Fabric monitor...
[Relayer] Stopped monitoring FABRIC_NET_01
[FiscoBcosMonitor] Stopped monitoring FISCO_NET_01
[Relayer] Stopped monitoring FISCO_NET_01
[Relayer] Relay service stopped

说明：
- 该终端保持运行，作为实时日志窗口
- ~/relayer.log 用于后续自动/手动验收

---

## 3. 一键双向验收（推荐）
项目根目录执行：

=========================================
跨链双向验收脚本
日志文件: /home/tr/relayer.log
=========================================
✗ 未检测到运行中的 Relayer 进程
请先执行: cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npm start | tee /home/tr/relayer.log

脚本会自动完成：
- Fabric -> FISCO（调用 
ode test-crosschain.js）
- FISCO -> Fabric（调用 console.sh ... send ...）
- 从 config.json 读取最新 Gateway 地址
- 在 ~/relayer.log 中做成功/失败断言
- 输出最终 PASS 或 FAILED

可选环境变量：



---

## 4. 手动双向验证（兜底）

### 4.1 Fabric -> FISCO

=== 跨链测试：Fabric -> FISCO-BCOS ===

1. 连接到 Fabric 网络...
   ✅ 已连接到 Fabric peer

2. 获取 gateway_cc 合约...
   ✅ 合约已获取

3. 发起跨链调用...
   目标链: FISCO_NET_01
   目标合约: 0x91d9ec991b3945baa9ca2f2790643a07ac677964
   目标函数: receiveLite
   负载: {"message":"Hello from Fabric!","timestamp":1770395260691}

   正在提交交易...

检查日志（注意使用 -a 防止日志中非文本字符导致匹配失败）：



### 4.2 FISCO -> Fabric

Invalid contract address:  

检查日志：



---

## 5. WSL 崩溃后的最短恢复流程

### 场景 A：全部重来（最稳）

=========================================
  跨链系统一键启动
=========================================
SKIP_FISCO: false
SKIP_FABRIC: false
SKIP_DEPLOY_CC: false
FAST_MODE: false
NO_DOWN: false
=========================================

[1/3] 启动 FISCO-BCOS 节点...
停止旧的 FISCO 节点...
try to stop node0
 node0 isn't running.
try to stop node1
 node1 isn't running.
try to stop node2
 node2 isn't running.
try to stop node3
 node3 isn't running.
启动 FISCO 节点...
try to start node0
try to start node1
try to start node2
try to start node3
[31m  Exceed waiting time. Please try again to start node1 [0m
[31m  Exceed waiting time. Please try again to start node2 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:24:22] The fisco-bcos is running...
[2026-02-07 00:27:43] exit because receive signal 15
[2026-02-07 00:27:43] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:27:47] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:27:49] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

[31m  Exceed waiting time. Please try again to start node3 [0m
[31m  Exceed waiting time. Please try again to start node0 [0m
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:24:22] The fisco-bcos is running...
[2026-02-07 00:27:42] exit because receive signal 15
[2026-02-07 00:27:42] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:27:47] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:27:49] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:24:22] The fisco-bcos is running...
[2026-02-07 00:27:44] exit because receive signal 15
[2026-02-07 00:27:44] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:27:47] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:27:49] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:24:22] The fisco-bcos is running...
[2026-02-07 00:27:41] exit because receive signal 15
[2026-02-07 00:27:41] fisco-bcos program exit normally.
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:27:47] The fisco-bcos is running...
the error = [libproviders.so: cannot open shared object file: No such file or directory]
FISCO BCOS Version : 3.11.0
Build Time         : 20240827 04:30:34
Build Type         : Linux/g++/Release
Git Branch         : HEAD
Git Commit         : 3fea676716990b2ed453b4f079915daafff451f9
[2026-02-07 00:27:49] start fisco-bcos failed, error:Dynamic exception type: std::runtime_error
std::exception::what: open rocksDB failed, msg:IO error: While lock file: data/LOCK: Resource temporarily unavailable

✗ FISCO-BCOS 启动失败

> crosschain-relayer@2.0.0 start
> node index.js

[Main] Loading configuration from: ./config.json
[Main] Starting CrossChain Relayer Service...
[Relayer] Initializing relay service...
[FabricMonitor] Initializing Fabric connection...
[FabricMonitor] Fabric connection initialized successfully
[Relayer] Initialized monitor for FABRIC_NET_01
[FiscoBcosMonitor] Initializing monitor for FISCO_NET_01
[FiscoBcosMonitor] Connecting to http://127.0.0.1:8545
[FiscoBcosMonitor] Connected! Current block: 130
[FiscoBcosMonitor] Gateway contract: 0x91d9ec991b3945baa9ca2f2790643a07ac677964
[FiscoBcosMonitor] Initialized, starting from block 130
[Relayer] Initialized monitor for FISCO_NET_01
[Relayer] Initialization complete
[Relayer] Starting relay service...
[FabricMonitor] Starting Fabric block monitoring...
[Relayer] Started monitoring FABRIC_NET_01
[FiscoBcosMonitor] Started monitoring FISCO_NET_01
[Relayer] Started monitoring FISCO_NET_01
[Relayer] Relay service started successfully
[Main] Relayer service is running
[FabricMonitor] Starting Fabric block monitoring...
=========================================
跨链双向验收脚本
日志文件: /home/tr/relayer.log
=========================================
✗ 未检测到运行中的 Relayer 进程
请先执行: cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npm start | tee /home/tr/relayer.log

### 场景 B：链大概率还在，仅恢复 Relayer


> crosschain-relayer@2.0.0 start
> node index.js

[Main] Loading configuration from: ./config.json
[Main] Starting CrossChain Relayer Service...
[Relayer] Initializing relay service...
[FabricMonitor] Initializing Fabric connection...
[FabricMonitor] Fabric connection initialized successfully
[Relayer] Initialized monitor for FABRIC_NET_01
[FiscoBcosMonitor] Initializing monitor for FISCO_NET_01
[FiscoBcosMonitor] Connecting to http://127.0.0.1:8545
[FiscoBcosMonitor] Connected! Current block: 130
[FiscoBcosMonitor] Gateway contract: 0x91d9ec991b3945baa9ca2f2790643a07ac677964
[FiscoBcosMonitor] Initialized, starting from block 130
[Relayer] Initialized monitor for FISCO_NET_01
[Relayer] Initialization complete
[Relayer] Starting relay service...
[FabricMonitor] Starting Fabric block monitoring...
[Relayer] Started monitoring FABRIC_NET_01
[FiscoBcosMonitor] Started monitoring FISCO_NET_01
[Relayer] Started monitoring FISCO_NET_01
[Relayer] Relay service started successfully
[Main] Relayer service is running
[FabricMonitor] Starting Fabric block monitoring...
=========================================
跨链双向验收脚本
日志文件: /home/tr/relayer.log
=========================================
✗ 未检测到运行中的 Relayer 进程
请先执行: cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npm start | tee /home/tr/relayer.log

---

## 6. 常见问题（按当前版本）

### 6.1 Abi is empty, please check contract abi exists
根因通常是：
- 合约地址不匹配当前部署
- 或旧版脚本错误回写了地址

修复：

=========================================
Bootstrap Script - 自动部署合约
=========================================
REDEPLOY_FISCO: true
RECEIVE_METHOD: receiveLite
SKIP_FABRIC_CC: true
SKIP_FISCO_CONTRACTS: false
=========================================

[1/3] 部署 FISCO 合约...
开始部署 FISCO 合约...

并验证地址可用：



出现 Return code: 0 即可。

### 6.2 channel already exists / ledger [mychannel] already exists
- 属于 Fabric 重启/复用场景常见现象
- 当前 start-all.sh 已做幂等处理，通常不影响后续

### 6.3 proxyconnect ...:7890 导致镜像拉取失败
- 先在当前 shell 执行 unset ...proxy...
- 检查 Docker Desktop 代理配置，避免 Docker 引擎使用失效代理

### 6.4 grep 查不到明明存在的日志
- 使用 grep -a 或 grep -an，因为日志可能包含非纯文本字符

---

## 7. 验收通过标准
满足以下四条即可判定当前跨链基础正常：
1. Fabric -> FISCO 日志出现 FISCO transaction SUCCESS
2. FISCO -> Fabric 日志出现 Fabric transaction success
3. 两个方向都出现 Message relayed successfully
4. 无 Abi is empty、无 Failed to relay



---

## Fabric 侧验证 FISCO 区块头（LightClient-lite）

现在 gateway_cc.Receive(...) 对非 Fabric 来源链启用严格校验：必须先在 Fabric 上通过 SubmitBlockHeader 顺序提交并验证对应的 FISCO block header，否则会直接报错 Source block not verified。

### 重新部署 Fabric 链码（升级）

~~~bash
cd /home/tr/projects/cross-chain
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

# 如需升级 gateway_cc（包含 LightClient-lite/严格校验）
./start-all.sh --redeploy-fabric-cc

cd fabric-chaincode/Relayer
npm start | tee ~/relayer.log

cd /home/tr/projects/cross-chain
./verify-crosschain.sh
~~~

如需手动指定版本/序列：

~~~bash
export FABRIC_CC_VERSION=1.1
export FABRIC_CC_SEQUENCE=2
./start-all.sh --redeploy-fabric-cc
~~~

---

## Cross-Chain Demo UI (WSL backend/frontend, Windows access)

~~~bash
cd /home/tr/projects/cross-chain
bash scripts/start-demo.sh
~~~

Expected output:
- `Windows URL (localhost): http://localhost:15173`
- `Windows URL (fallback):  http://<wsl-ip>:15173`

Stop demo services:

~~~bash
cd /home/tr/projects/cross-chain
bash scripts/stop-demo.sh
~~~

API routes for UI/integration:
- `GET /health`
- `GET /demo/status`
- `GET /demo/events`
- `GET /demo/stream` (SSE)
- `POST /demo/trigger/fabric-to-fisco`
- `POST /demo/trigger/fisco-to-fabric`
