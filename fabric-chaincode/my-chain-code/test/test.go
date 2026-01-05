/*
SPDX-License-Identifier: Apache-2.0
*/

package main

import (
	"encoding/json"
	"fmt"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	
	"log"
)

// SmartContract provides functions for managing an Asset
type SmartContract struct {
	contractapi.Contract
}

// Asset describes basic details of what makes up a simple asset
// Insert struct field in alphabetic order => to achieve determinism across languages
// golang keeps the order when marshal to json but doesn't order automatically
type Asset struct {
	AppraisedValue int    `json:"AppraisedValue"`
	Color          string `json:"Color"`
	ID             string `json:"ID"`
	Owner          string `json:"Owner"`
	Size           int    `json:"Size"`
}

// InitLedger adds a base set of assets to the ledger
func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	assets := []Asset{
		{ID: "asset1", Color: "blue", Size: 5, Owner: "Tomoko", AppraisedValue: 300},
		{ID: "asset2", Color: "red", Size: 5, Owner: "Brad", AppraisedValue: 400},
		{ID: "asset3", Color: "green", Size: 10, Owner: "Jin Soo", AppraisedValue: 500},
		{ID: "asset4", Color: "yellow", Size: 10, Owner: "Max", AppraisedValue: 600},
		{ID: "asset5", Color: "black", Size: 15, Owner: "Adriana", AppraisedValue: 700},
		{ID: "asset6", Color: "white", Size: 15, Owner: "Michel", AppraisedValue: 800},
	}

	for _, asset := range assets {
		assetJSON, err := json.Marshal(asset)
		if err != nil {
			return err
		}

		err = ctx.GetStub().PutState(asset.ID, assetJSON)
		if err != nil {
			return fmt.Errorf("failed to put to world state. %v", err)
		}
	}

	return nil
}

// ReadAsset returns the asset stored in the world state with given id.
func (s *SmartContract) ReadAsset(ctx contractapi.TransactionContextInterface, id string) (*Asset, error) {
	assetJSON, err := ctx.GetStub().GetState(id)
	if err != nil {
		return nil, fmt.Errorf("failed to read from world state: %v", err)
	}
	if assetJSON == nil {
		return nil, fmt.Errorf("the asset %s does not exist", id)
	}

	var asset Asset
	err = json.Unmarshal(assetJSON, &asset)
	if err != nil {
		return nil, err
	}

	return &asset, nil
}

// func (s *SmartContract) InvokeTest2(ctx contractapi.TransactionContextInterface) (*Asset, error) {
// 	targetChaincodeName := "test2_cc"
// 	// 假设我们调用目标链码的 "ReadAsset2" 方法，并传递参数
// 	invokeArgs1 := make([][]byte, 1)
// 	invokeArgs1[0] = []byte("InitLedger")
// 	// 调用另一个链码
// 	response1 := ctx.GetStub().InvokeChaincode(targetChaincodeName, invokeArgs1, "")
// 	if response1.Status != 200 {
// 		return nil, fmt.Errorf("Failed to invoke target chaincode1: %s", response1.Message)
// 	}

// 	invokeArgs := make([][]byte, 2)
// 	invokeArgs[0] = []byte("ReadAsset2")
// 	invokeArgs[1] = []byte("asset1")

// 	// 调用另一个链码
// 	response := ctx.GetStub().InvokeChaincode(targetChaincodeName, invokeArgs, "")
// 	if response.Status != 200 {
// 		return nil, fmt.Errorf("Failed to invoke target chaincode: %s", response.Message)
// 	}
// 	// 解析目标链码返回的 Asset 数据
// 	var asset Asset
// 	err := json.Unmarshal(response.Payload, &asset)
// 	if err != nil {
// 		return nil, fmt.Errorf("Failed to parse asset data: %s", err.Error())
// 	}

// 	// ... 后续逻辑
// 	return &asset, nil
// }


func main() {
	assetChaincode, err := contractapi.NewChaincode(&SmartContract{})
	if err != nil {
		log.Panicf("Error creating asset-transfer-basic chaincode: %v", err)
	}

	if err := assetChaincode.Start(); err != nil {
		log.Panicf("Error starting asset-transfer-basic chaincode: %v", err)
	}
}
