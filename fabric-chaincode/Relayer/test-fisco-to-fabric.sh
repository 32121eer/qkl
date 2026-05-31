#!/bin/bash
# 测试 FISCO -> Fabric 跨链
# 需要先启动 FISCO Console，然后复制以下命令执行

echo "=========================================="
echo "   测试 FISCO -> Fabric 跨链"
echo "=========================================="
echo ""
echo "请在 FISCO Console 中执行以下命令:"
echo ""
echo "call Gateway 0xcceef68c9b4811b32c75df284a1396c7c5509561 send \"FABRIC_NET_01\" \"mychannel/gateway_cc\" \"Receive\" 0x48656c6c6f"
echo ""
echo "然后观察 Relayer 日志，应该看到:"
echo "  [FiscoBcosMonitor] 🎯 CrossChainCall event detected!"
echo "  [MessageHandler] ✅ Fabric transaction success"
echo ""

