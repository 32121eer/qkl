package main

import (
	"fmt"

	"github.com/hyperledger/fabric-chaincode-go/shim"
	pb "github.com/hyperledger/fabric-protos-go/peer"
)

type CrossChainCC struct{}

func (cc *CrossChainCC) Init(stub shim.ChaincodeStubInterface) pb.Response {
	return shim.Success(nil)
}

func (cc *CrossChainCC) Invoke(stub shim.ChaincodeStubInterface) pb.Response {
	fn, _ := stub.GetFunctionAndParameters()
	if fn == "emit" {
		// 触发事件，payload 为 "Hello"
		if err := stub.SetEvent("CrossChainCall", []byte("Hello")); err != nil {
			return shim.Error(fmt.Sprintf("set event failed: %v", err))
		}
		return shim.Success([]byte("event emitted"))
	}
	return shim.Error("unsupported function, use 'emit'")
}

func main() {
	if err := shim.Start(new(CrossChainCC)); err != nil {
		fmt.Printf("Error starting chaincode: %v", err)
	}
}
