package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/hyperledger/fabric-chaincode-go/shimtest"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/stretchr/testify/assert"
)

// 创建测试用的 TransactionContext
func createTestContext() *contractapi.TransactionContext {
	stub := shimtest.NewMockStub("gateway", nil)
	
	// 设置交易ID
	stub.MockTransactionStart("test-tx-id")
	
	// 设置时间戳
	now := time.Now()
	stub.TxTimestamp = &timestamp.Timestamp{
		Seconds: now.Unix(),
		Nanos:   int32(now.Nanosecond()),
	}
	
	txContext := new(contractapi.TransactionContext)
	txContext.SetStub(stub)
	return txContext
}

// 测试1: Send函数基本功能
func TestSend(t *testing.T) {
	// 1. 创建链码和上下文
	gc := new(GatewayChaincode)
	ctx := createTestContext()

	// 2. 调用Send函数
	nonce, err := gc.Send(
		ctx,
		"fisco-bcos-001",
		"SaleContract",
		"receivePlantInfo",
		[]byte(`{"productId":"KW001","farmName":"阳光果园"}`),
	)

	// 3. 验证调用成功
	assert.NoError(t, err, "Send should not return error")
	assert.NotEmpty(t, nonce, "Should return nonce")

	t.Logf("✓ Send调用成功")
	t.Logf("  返回的nonce: %s", nonce)
}

// 测试2: Receive函数基本功能
func TestReceive(t *testing.T) {
	gc := new(GatewayChaincode)
	ctx := createTestContext()

	// 调用Receive函数
	err := gc.Receive(
		ctx,
		"fabric-chain-001",
		"0xfabric_tx_123abc",
		uint64(1500),
		[]byte(`{"productId":"KW001","farmName":"阳光果园"}`),
		`["0xhash1","0xhash2"]`,
	)

	assert.NoError(t, err, "Receive should not return error")
	t.Logf("✓ Receive调用成功")
	t.Logf("✓ 消息已标记为已处理")
}

// 测试3: 防重放机制
func TestReceive_PreventReplay(t *testing.T) {
	gc := new(GatewayChaincode)
	ctx := createTestContext()

	// 第一次接收消息
	err1 := gc.Receive(
		ctx,
		"fabric-chain-001",
		"0xfabric_tx_456def",
		uint64(1501),
		[]byte(`{"productId":"KW002"}`),
		`["0xhash1"]`,
	)

	assert.NoError(t, err1, "First receive should succeed")
	t.Logf("✓ 第一次接收消息成功")

	// 第二次接收相同消息（重放攻击）
	err2 := gc.Receive(
		ctx,
		"fabric-chain-001",
		"0xfabric_tx_456def",
		uint64(1501),
		[]byte(`{"productId":"KW002"}`),
		`["0xhash1"]`,
	)

	// 验证第二次调用被拒绝
	assert.Error(t, err2, "Replay should be rejected")
	assert.Contains(t, err2.Error(), "already processed")
	
	t.Logf("✓ 防重放机制工作正常")
	t.Logf("  错误信息: %s", err2.Error())
}

// 测试4: IsMessageProcessed查询功能
func TestIsMessageProcessed(t *testing.T) {
	gc := new(GatewayChaincode)
	ctx := createTestContext()

	// 先接收一条消息
	gc.Receive(
		ctx,
		"fabric-chain-001",
		"0xfabric_tx_789ghi",
		uint64(1502),
		[]byte(`{"productId":"KW003"}`),
		`["0xhash1"]`,
	)

	// 查询该消息是否已处理
	processed, err := gc.IsMessageProcessed(
		ctx,
		"fabric-chain-001",
		"0xfabric_tx_789ghi",
		uint64(1502),
	)

	assert.NoError(t, err, "Query should not return error")
	assert.True(t, processed, "Message should be marked as processed")

	t.Logf("✓ IsMessageProcessed查询成功")
	t.Logf("  消息已处理: %v", processed)

	// 查询未处理的消息
	processed2, err := gc.IsMessageProcessed(
		ctx,
		"fabric-chain-001",
		"0xnon_existent_tx",
		uint64(9999),
	)

	assert.NoError(t, err)
	assert.False(t, processed2, "Non-existent message should return false")

	t.Logf("✓ 查询未处理消息返回false")
}

// 测试5: Send和Receive的完整流程
func TestSendReceiveFlow(t *testing.T) {
	gc := new(GatewayChaincode)
	ctx := createTestContext()

	// 步骤1: 发送消息
	t.Log("步骤1: 调用Send发送跨链消息")
	nonce, err := gc.Send(
		ctx,
		"fisco-bcos-001",
		"SaleContract",
		"receivePlantInfo",
		[]byte(`{"productId":"KW004","farmName":"测试果园"}`),
	)

	assert.NoError(t, err)
	assert.NotEmpty(t, nonce)
	t.Logf("  ✓ 发送成功，nonce: %s", nonce)

	// 步骤2: 模拟接收消息
	t.Log("步骤2: 调用Receive接收跨链消息")
	err = gc.Receive(
		ctx,
		"fabric-chain-001",
		"0xtest_tx_flow",
		uint64(2000),
		[]byte(`{"productId":"KW004","farmName":"测试果园"}`),
		`["0xhash1","0xhash2"]`,
	)

	assert.NoError(t, err)
	t.Logf("  ✓ 接收成功")

	// 步骤3: 验证消息状态
	t.Log("步骤3: 查询消息处理状态")
	processed, err := gc.IsMessageProcessed(
		ctx,
		"fabric-chain-001",
		"0xtest_tx_flow",
		uint64(2000),
	)

	assert.NoError(t, err)
	assert.True(t, processed)
	t.Logf("  ✓ 消息状态已确认为已处理")

	t.Log("✓ Send→Receive完整流程测试通过")
}

// 测试6: 数据结构序列化
func TestCrossChainMessageSerialization(t *testing.T) {
	msg := CrossChainMessage{
		TargetChainID:  "fisco-bcos-001",
		TargetContract: "SaleContract",
		TargetFunction: "receivePlantInfo",
		Payload:        []byte(`{"productId":"KW005"}`),
		Nonce:          "test_nonce_123",
	}

	// 序列化
	data, err := json.Marshal(msg)
	assert.NoError(t, err)
	t.Logf("序列化结果: %s", string(data))

	// 反序列化
	var msg2 CrossChainMessage
	err = json.Unmarshal(data, &msg2)
	assert.NoError(t, err)
	assert.Equal(t, msg.TargetChainID, msg2.TargetChainID)
	assert.Equal(t, msg.Nonce, msg2.Nonce)

	t.Log("✓ 数据结构序列化测试通过")
}
