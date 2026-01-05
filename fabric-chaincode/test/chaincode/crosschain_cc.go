package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type Asset struct {
	AppraisedValue int    `json:"AppraisedValue"`
	Color          string `json:"Color"`
	ID             string `json:"ID"`
	Owner          string `json:"Owner"`
	Size           int    `json:"Size"`
}

type CrossChainCC struct {
	contractapi.Contract
}

func (s *CrossChainCC) readState(ctx contractapi.TransactionContextInterface, id string) ([]byte, error) {
	assetJSON, err := ctx.GetStub().GetState(id)
	if err != nil {
		return nil, fmt.Errorf("failed to read from world state: %w", err)
	}
	if assetJSON == nil {
		return nil, fmt.Errorf("the asset %s does not exist", id)
	}

	return assetJSON, nil
}

// InitLedger adds a base set of assets to the ledger
// CreateAsset issues a new asset to the world state with given details.
func (s *CrossChainCC) CreateAsset(ctx contractapi.TransactionContextInterface) error {
	// existing, err := s.readState(ctx, id)
	// if err == nil && existing != nil {
	// 	return fmt.Errorf("the asset %s already exists", id)
	// }

	asset := Asset{
		ID:             "1",
		Color:          "red",
		Size:           100,
		Owner:          "John",
		AppraisedValue: 1000,
	}
	assetJSON, err := json.Marshal(asset)
	if err != nil {
		return err
	}
	err = ctx.GetStub().PutState("1", assetJSON)
	if err != nil {
		return fmt.Errorf("failed to put state: %w", err)
	}
	eventErr := ctx.GetStub().SetEvent("CreateAsset", assetJSON)
	if eventErr != nil {
		return fmt.Errorf("failed to set event: %w", eventErr)
	}
	return nil
}

// func (cc *CrossChainCC) Init(stub shim.ChaincodeStubInterface) pb.Response {
// 	return shim.Success(nil)
// }

// func (cc *CrossChainCC) Invoke(stub shim.ChaincodeStubInterface) pb.Response {
// 	fn, _ := stub.GetFunctionAndParameters()

// 	if fn == "emit" {
// 		// 触发事件，payload 为 "Hello"
// 		if err := stub.SetEvent("CrossChainCall", []byte("Hello")); err != nil {
// 			return shim.Error(fmt.Sprintf("set event failed: %v", err))
// 		}
// 		return shim.Success([]byte("event emitted! hello!"))
// 	}
// 	return shim.Error("unsupported function, use 'emit'")
// }

func main() {
	chaincode, err := contractapi.NewChaincode(new(CrossChainCC)) // 使用Contract API的启动方式
	if err != nil {
		fmt.Printf("Error creating crosschain chaincode: %v", err)
		return
	}
	if err := chaincode.Start(); err != nil { // 启动链码
		fmt.Printf("Error starting crosschain chaincode: %v", err)
	}
}
