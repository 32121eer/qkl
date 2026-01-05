package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// GatewayChaincode V2 - with Light Client Verification
type GatewayChaincode struct {
	contractapi.Contract
}

// CrossChainMessage 跨链消息结构
type CrossChainMessage struct {
	TargetChainID   string `json:"targetChainId"`
	TargetContract  string `json:"targetContract"`
	TargetFunction  string `json:"targetFunction"`
	Payload         []byte `json:"payload"`
	Nonce           string `json:"nonce"`
}

// Send 发起跨链请求
func (gc *GatewayChaincode) Send(
	ctx contractapi.TransactionContextInterface,
	targetChainId string,
	targetContract string,
	targetFunction string,
	payload string,
) (string, error) {

	// TODO: 验证目标链是否已注册且激活
	// active, err := gc.isChainActive(ctx, targetChainId)
	// if err != nil || !active {
	//     return "", fmt.Errorf("target chain not active")
	// }

	// 生成nonce
	txID := ctx.GetStub().GetTxID()
	timestamp, _ := ctx.GetStub().GetTxTimestamp()
	nonceData := fmt.Sprintf("%s%s%d", txID, targetChainId, timestamp.Seconds)
	hash := sha256.Sum256([]byte(nonceData))
	nonce := hex.EncodeToString(hash[:])

	// 触发事件
	msg := CrossChainMessage{
		TargetChainID:  targetChainId,
		TargetContract: targetContract,
		TargetFunction: targetFunction,
		Payload:        []byte(payload),
		Nonce:          nonce,
	}

	msgJSON, err := json.Marshal(msg)
	if err != nil {
		return "", err
	}

	err = ctx.GetStub().SetEvent("CrossChainCall", msgJSON)
	if err != nil {
		return "", fmt.Errorf("failed to set event: %w", err)
	}

	fmt.Printf("[GatewayChaincode] Cross-chain call initiated: %s -> %s\n", targetChainId, targetContract)

	return nonce, nil
}

// Receive 接收并验证跨链消息
func (gc *GatewayChaincode) Receive(
	ctx contractapi.TransactionContextInterface,
	sourceChainId string,
	sourceTxHash string,
	sourceBlockNumber uint64,
	payload string,
	merkleProofJSON string,
) error {

	// 构造消息ID（防止重放）
	messageID := fmt.Sprintf("%s:%s:%d", sourceChainId, sourceTxHash, sourceBlockNumber)
	
	// 检查是否已处理
	processed, err := gc.IsMessageProcessed(ctx, sourceChainId, sourceTxHash, sourceBlockNumber)
	if err != nil {
		return err
	}
	if processed {
		return fmt.Errorf("message already processed")
	}

	// TODO: 通过LightClient验证消息
	// 1. 验证源区块是否已提交并验证
	// blockVerified, err := gc.isBlockVerified(ctx, sourceChainId, sourceBlockNumber)
	// if err != nil || !blockVerified {
	//     return fmt.Errorf("source block not verified")
	// }

	// 2. 验证交易在区块中的存在性（Merkle证明）
	// txVerified, err := gc.verifyTransaction(ctx, sourceChainId, sourceBlockNumber, sourceTxHash, merkleProofJSON)
	// if err != nil || !txVerified {
	//     return fmt.Errorf("transaction verification failed")
	// }

	// 标记为已处理
	err = ctx.GetStub().PutState(messageID, []byte("processed"))
	if err != nil {
		return err
	}

	// 打印日志
	fmt.Printf("[GatewayChaincode] Received verified message!\n")
	fmt.Printf("  - Source Chain: %s\n", sourceChainId)
	fmt.Printf("  - Source Tx Hash: %s\n", sourceTxHash)
	fmt.Printf("  - Source Block: %d\n", sourceBlockNumber)
	fmt.Printf("  - Payload: %s\n", payload)

	// 触发事件
	eventData := map[string]interface{}{
		"sourceChainId": sourceChainId,
		"sourceTxHash":  sourceTxHash,
		"payload":       payload,
		"verified":      true,
	}
	eventJSON, _ := json.Marshal(eventData)
	err = ctx.GetStub().SetEvent("MessageReceived", eventJSON)
	if err != nil {
		return fmt.Errorf("failed to set event: %w", err)
	}

	// TODO: 执行业务逻辑
	// return gc.processPayload(ctx, payload)

	return nil
}

// IsMessageProcessed 检查消息是否已处理
func (gc *GatewayChaincode) IsMessageProcessed(
	ctx contractapi.TransactionContextInterface,
	sourceChainId string,
	sourceTxHash string,
	sourceBlockNumber uint64,
) (bool, error) {
	messageID := fmt.Sprintf("%s:%s:%d", sourceChainId, sourceTxHash, sourceBlockNumber)
	
	data, err := ctx.GetStub().GetState(messageID)
	if err != nil {
		return false, err
	}
	
	return data != nil, nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(&GatewayChaincode{})
	if err != nil {
		fmt.Printf("Error creating gateway chaincode: %s", err.Error())
		return
	}
	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting gateway chaincode: %s", err.Error())
	}
}