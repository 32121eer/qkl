package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// RegistryChaincode 链注册表链码
type RegistryChaincode struct {
	contractapi.Contract
}

// ChainInfo 链注册信息
type ChainInfo struct {
	ChainID       string   `json:"chainId"`
	ChainType     string   `json:"chainType"`     // "FABRIC", "FISCO_BCOS"
	Endpoint      string   `json:"endpoint"`
	PublicKey     string   `json:"publicKey"`
	ConsensusType string   `json:"consensusType"`
	RegisteredAt  int64    `json:"registeredAt"`
	Validators    []string `json:"validators"`
	Certificate   string   `json:"certificate"`
	Status        string   `json:"status"` // "ACTIVE", "SUSPENDED", "PENDING"
}

// RegisterChain 注册新链
func (rc *RegistryChaincode) RegisterChain(
	ctx contractapi.TransactionContextInterface,
	chainID string,
	chainType string,
	endpoint string,
	publicKey string,
	consensusType string,
	certificate string,
	validatorsJSON string,
) error {
	
	// 检查链是否已注册
	exists, err := rc.ChainExists(ctx, chainID)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("chain %s already registered", chainID)
	}
	
	// 解析验证者列表
	var validators []string
	if err := json.Unmarshal([]byte(validatorsJSON), &validators); err != nil {
		return fmt.Errorf("failed to parse validators: %v", err)
	}
	
	if len(validators) == 0 {
		return fmt.Errorf("at least one validator required")
	}
	
	// 创建链信息
	chainInfo := ChainInfo{
		ChainID:       chainID,
		ChainType:     chainType,
		Endpoint:      endpoint,
		PublicKey:     publicKey,
		ConsensusType: consensusType,
		RegisteredAt:  time.Now().Unix(),
		Validators:    validators,
		Certificate:   certificate,
		Status:        "ACTIVE",
	}
	
	// 序列化并存储
	chainJSON, err := json.Marshal(chainInfo)
	if err != nil {
		return err
	}
	
	err = ctx.GetStub().PutState(chainID, chainJSON)
	if err != nil {
		return fmt.Errorf("failed to put chain info: %v", err)
	}
	
	// 触发事件
	eventPayload := map[string]interface{}{
		"chainId":   chainID,
		"chainType": chainType,
		"timestamp": chainInfo.RegisteredAt,
	}
	eventJSON, _ := json.Marshal(eventPayload)
	ctx.GetStub().SetEvent("ChainRegistered", eventJSON)
	
	return nil
}

// UpdateChainStatus 更新链状态
func (rc *RegistryChaincode) UpdateChainStatus(
	ctx contractapi.TransactionContextInterface,
	chainID string,
	newStatus string,
) error {
	chainInfo, err := rc.GetChainInfo(ctx, chainID)
	if err != nil {
		return err
	}
	
	chainInfo.Status = newStatus
	
	chainJSON, err := json.Marshal(chainInfo)
	if err != nil {
		return err
	}
	
	err = ctx.GetStub().PutState(chainID, chainJSON)
	if err != nil {
		return err
	}
	
	// 触发事件
	eventPayload := map[string]string{
		"chainId":   chainID,
		"newStatus": newStatus,
	}
	eventJSON, _ := json.Marshal(eventPayload)
	ctx.GetStub().SetEvent("ChainStatusUpdated", eventJSON)
	
	return nil
}

// GetChainInfo 获取链信息
func (rc *RegistryChaincode) GetChainInfo(
	ctx contractapi.TransactionContextInterface,
	chainID string,
) (*ChainInfo, error) {
	chainJSON, err := ctx.GetStub().GetState(chainID)
	if err != nil {
		return nil, fmt.Errorf("failed to read chain info: %v", err)
	}
	if chainJSON == nil {
		return nil, fmt.Errorf("chain %s not found", chainID)
	}
	
	var chainInfo ChainInfo
	err = json.Unmarshal(chainJSON, &chainInfo)
	if err != nil {
		return nil, err
	}
	
	return &chainInfo, nil
}

// ChainExists 检查链是否存在
func (rc *RegistryChaincode) ChainExists(
	ctx contractapi.TransactionContextInterface,
	chainID string,
) (bool, error) {
	chainJSON, err := ctx.GetStub().GetState(chainID)
	if err != nil {
		return false, fmt.Errorf("failed to read from world state: %v", err)
	}
	
	return chainJSON != nil, nil
}

// IsChainActive 验证链是否激活
func (rc *RegistryChaincode) IsChainActive(
	ctx contractapi.TransactionContextInterface,
	chainID string,
) (bool, error) {
	chainInfo, err := rc.GetChainInfo(ctx, chainID)
	if err != nil {
		return false, err
	}
	
	return chainInfo.Status == "ACTIVE", nil
}

// GetAllChains 获取所有注册的链
func (rc *RegistryChaincode) GetAllChains(
	ctx contractapi.TransactionContextInterface,
) ([]*ChainInfo, error) {
	// 使用复合键查询（实际应用中需要更复杂的索引）
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()
	
	var chains []*ChainInfo
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}
		
		var chainInfo ChainInfo
		err = json.Unmarshal(queryResponse.Value, &chainInfo)
		if err != nil {
			continue // 跳过非ChainInfo数据
		}
		chains = append(chains, &chainInfo)
	}
	
	return chains, nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(&RegistryChaincode{})
	if err != nil {
		fmt.Printf("Error creating registry chaincode: %s", err.Error())
		return
	}
	
	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting registry chaincode: %s", err.Error())
	}
}
