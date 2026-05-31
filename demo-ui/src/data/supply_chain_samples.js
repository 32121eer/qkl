/**
 * 供应链跨链演示 — 预置示例数据集
 * 基于论文《Data sharing in food supply chains》中的 4 个案例设计
 */

export const SCENARIOS = [
  {
    id: 'pre-harvest',
    title: '采购决策',
    subtitle: 'FISCO采购方 → Fabric种植基地',
    icon: '🌾',
    description: '采购方在收获季前，跨链查询种植园的作物状况、产量预测与库存，用于采购计划决策。',
    story: '华南生鲜集团的采购经理要制定Q4苹果采购计划，需要了解桂林种植基地的产量预测和品质数据——这些数据在对方的Fabric链上。',
    fiscoOwner: '华南生鲜集团',
    fiscoRole: '采购方',
    fabricOwner: '桂林红富士种植基地 / 武功山猕猴桃基地',
    fabricRole: '农场',
    color: '#2ea39d',
    records: [
      {
        payloadVersion: '1.0',
        orchardBatchId: 'APPLE-FARM-2026-S1',
        eventType: 'pre_harvest_report',
        eventAt: '2026-03-01T08:00:00Z',
        sourceSystem: 'orchard-iot',
        data: {
          farmName: '桂林红富士种植基地',
          crop: 'apple',
          variety: '红富士',
          region: '广西桂林',
          cropCondition: {
            sugarContent: 14.2,
            sugarUnit: 'Brix',
            hardness: 7.8,
            hardnessUnit: 'kg/cm²',
            avgSize: '85mm',
            colorIndex: 4.2,
            maturityStage: '转色期'
          },
          yieldForecast: {
            estimatedTons: 120,
            gradeA_ratio: 0.65,
            harvestWindow: '2026-10-15 ~ 2026-11-10'
          },
          inventory: {
            coldStorageCapacityTons: 200,
            currentStockTons: 0,
            packagingMaterials: '充足'
          },
          logistics: {
            transportCapacity: '30吨/天',
            coldChainReady: true,
            nearestPort: '桂林西站'
          }
        }
      },
      {
        payloadVersion: '1.0',
        orchardBatchId: 'KIWI-FARM-2026-S1',
        eventType: 'pre_harvest_report',
        eventAt: '2026-03-01T09:00:00Z',
        sourceSystem: 'orchard-iot',
        data: {
          farmName: '武功山猕猴桃基地',
          crop: 'kiwifruit',
          variety: '翠香',
          region: '江西萍乡',
          cropCondition: {
            sugarContent: 16.5,
            sugarUnit: 'Brix',
            hardness: 5.2,
            hardnessUnit: 'kg/cm²',
            avgWeight: '95g',
            dryMatter: 19.8,
            dryMatterUnit: '%'
          },
          yieldForecast: {
            estimatedTons: 80,
            gradeA_ratio: 0.72,
            harvestWindow: '2026-09-01 ~ 2026-09-30'
          },
          marketForecast: {
            expectedPrice: 12.5,
            priceUnit: '元/kg',
            demandTrend: '上升',
            majorBuyers: ['果汁加工厂', '生鲜超市']
          }
        }
      }
    ]
  },
  {
    id: 'processing',
    title: '监管审计',
    subtitle: 'FISCO监管方 → Fabric加工厂',
    icon: '🏭',
    description: '监管方跨链查询加工厂的批次记录：原料来源、加工参数、质检报告，确保食品安全合规。',
    story: '市食品监督管理局对"绿源浓缩苹果汁"进行例行抽检，需要核实加工厂的原料来源和质检报告——这些数据在对方的Fabric链上。',
    fiscoOwner: '市食品监督管理局',
    fiscoRole: '监管方',
    fabricOwner: '绿源果汁加工厂 / 果干加工车间',
    fabricRole: '工厂',
    color: '#2d7dfd',
    records: [
      {
        payloadVersion: '1.0',
        orchardBatchId: 'JUICE-BATCH-20260301',
        eventType: 'processing_record',
        eventAt: '2026-03-01T14:00:00Z',
        sourceSystem: 'factory-mes',
        data: {
          factoryName: '绿源果汁加工厂',
          productType: '浓缩苹果汁',
          productCode: 'AJC-70',
          rawMaterial: {
            sourceBatch: 'APPLE-FARM-2026-S1',
            sourceFarm: '桂林红富士种植基地',
            receivedWeight: 5000,
            weightUnit: 'kg',
            inspectionPass: true,
            pesticideResidueTest: '合格'
          },
          processing: {
            crushDate: '2026-03-01',
            crushMethod: '带式压榨',
            pasteurizationTemp: 121,
            pasteurizationUnit: '°C',
            pasteurizationDuration: '15s',
            concentrationBrix: 70,
            filterMethod: '超滤膜'
          },
          qualityTest: {
            acidity: 3.2,
            acidityUnit: 'pH',
            leadContent: 0.001,
            leadUnit: 'mg/kg',
            microbialCount: 50,
            microbialUnit: 'CFU/mL',
            testDate: '2026-03-01',
            testOrg: '省食品质检中心',
            conclusion: '合格'
          }
        }
      },
      {
        payloadVersion: '1.0',
        orchardBatchId: 'DRIED-BATCH-20260305',
        eventType: 'processing_record',
        eventAt: '2026-03-05T10:00:00Z',
        sourceSystem: 'factory-mes',
        data: {
          factoryName: '果干加工车间',
          productType: '猕猴桃干',
          productCode: 'DKF-01',
          rawMaterial: {
            sourceBatch: 'KIWI-FARM-2026-S1',
            sourceFarm: '武功山猕猴桃基地',
            receivedWeight: 2000,
            weightUnit: 'kg',
            inspectionPass: true
          },
          processing: {
            sliceThickness: '5mm',
            preTreatment: '柠檬酸浸泡',
            dryingTemp: 65,
            dryingTempUnit: '°C',
            dryingHours: 18,
            dryingMethod: '热风循环'
          },
          qualityTest: {
            moisture: 12.5,
            moistureUnit: '%',
            sulfurDioxide: 0.02,
            sulfurUnit: 'g/kg',
            colorScore: 4.5,
            testDate: '2026-03-05',
            conclusion: '合格'
          }
        }
      }
    ]
  },
  {
    id: 'safety-trace',
    title: '安全追溯',
    subtitle: 'FISCO监管方 → Fabric全链',
    icon: '🔍',
    description: '从问题产品出发，逐环节倒追：零售 → 运输 → 加工 → 种植，还原完整链路。',
    story: '消费者投诉苹果汁异味，监管方启动全链追溯：零售→运输→加工→种植，需要4次跨链查询Fabric上各环节的生产数据。',
    fiscoOwner: '市食品监督管理局',
    fiscoRole: '监管方',
    fabricOwner: '多个所有者',
    fabricRole: '零售/物流/工厂/农场',
    color: '#c14c4c',
    records: [
      {
        payloadVersion: '1.0',
        orchardBatchId: 'TRANSPORT-20260310-J01',
        eventType: 'transport_record',
        eventAt: '2026-03-10T06:00:00Z',
        sourceSystem: 'logistics-tms',
        data: {
          carrier: '冷链物流A公司',
          vehiclePlate: '桂A·冷1234',
          route: '桂林 → 广州',
          linkedBatch: 'JUICE-BATCH-20260301',
          departureTime: '2026-03-10T06:00:00Z',
          arrivalTime: '2026-03-10T20:00:00Z',
          temperature: {
            setPoint: 4,
            min: 2.1,
            max: 4.8,
            unit: '°C',
            monitorInterval: '5min'
          },
          humidity: { avg: 85, unit: '%' },
          handoverInspection: {
            passed: true,
            inspector: '张三',
            note: '包装完好，温度正常'
          }
        }
      },
      {
        payloadVersion: '1.0',
        orchardBatchId: 'RETAIL-SALE-20260312',
        eventType: 'retail_record',
        eventAt: '2026-03-12T09:00:00Z',
        sourceSystem: 'retail-pos',
        data: {
          retailer: '广州天河生鲜超市',
          productName: '绿源浓缩苹果汁 250mL',
          shelfBatch: 'JC-GZ-0312-A05',
          linkedTransport: 'TRANSPORT-20260310-J01',
          linkedProcessing: 'JUICE-BATCH-20260301',
          linkedFarm: 'APPLE-FARM-2026-S1',
          receiveDate: '2026-03-11',
          shelfDate: '2026-03-12',
          storageTemp: '2~6°C',
          quantity: 500,
          unit: '瓶'
        }
      },
      {
        payloadVersion: '1.0',
        orchardBatchId: 'SAFETY-TRACE-20260315',
        eventType: 'safety_trace_request',
        eventAt: '2026-03-15T10:00:00Z',
        sourceSystem: 'regulatory-system',
        data: {
          traceReason: '消费者投诉：异味',
          complaintProduct: '绿源浓缩苹果汁 250mL',
          complaintBatch: 'JC-GZ-0312-A05',
          traceChain: [
            { step: 1, batchId: 'RETAIL-SALE-20260312', role: '零售', status: '待查' },
            { step: 2, batchId: 'TRANSPORT-20260310-J01', role: '运输', status: '待查' },
            { step: 3, batchId: 'JUICE-BATCH-20260301', role: '加工', status: '待查' },
            { step: 4, batchId: 'APPLE-FARM-2026-S1', role: '种植', status: '待查' }
          ],
          priority: '高',
          deadline: '2026-03-17T18:00:00Z'
        }
      }
    ]
  }
];

/**
 * FISCO 侧本地业务数据 — 模拟采购方/监管方视角
 * needsCrossChainData 非空时指向 Fabric batchId，标识需要跨链获取生产数据
 */
export const FISCO_LOCAL_SAMPLES = {
  'pre-harvest': [
    {
      recordId: 'FISCO-PURCHASE-PLAN-2026-Q4',
      category: 'purchase_plan',
      title: '2026Q4 苹果采购计划',
      needsCrossChainData: 'APPLE-FARM-2026-S1',
      comparison: {
        question: '基地产量能满足采购需求吗？品质是否达到A级>=60%的要求？',
        rules: [
          { label: '需求量', localValue: '50吨', remoteField: 'data.yieldForecast.estimatedTons', remoteUnit: '吨', op: 'lte', localNum: 50 },
          { label: 'A级比例', localValue: '>=60%', remoteField: 'data.yieldForecast.gradeA_ratio', remoteUnit: '', op: 'lte', localNum: 0.60, isPercent: true },
          { label: '交货窗口', localValue: '10/20~11/05', remoteField: 'data.yieldForecast.harvestWindow', op: 'info' }
        ]
      },
      data: {
        buyer: '华南生鲜集团',
        targetProduct: '红富士苹果',
        requiredTons: 50,
        gradeRequirement: 'A级>=60%',
        deliveryWindow: '2026-10-20 ~ 2026-11-05',
        budgetPerKg: 8.5,
        budgetUnit: '元/kg',
        note: '需跨链查询种植基地产量预测和品质数据'
      }
    },
    {
      recordId: 'FISCO-MARKET-FORECAST-2026',
      category: 'market_forecast',
      title: '2026年秋季水果市场预测',
      needsCrossChainData: null,
      data: {
        analyst: '果品行情研究院',
        period: '2026年9月-11月',
        applePriceRange: '6.0~9.5 元/kg',
        appleTrend: '供应充足，价格平稳',
        kiwiPriceRange: '10.0~15.0 元/kg',
        kiwiTrend: '优质品种需求上升',
        riskFactors: ['极端天气', '物流成本上涨']
      }
    },
    {
      recordId: 'FISCO-PURCHASE-PLAN-KIWI-2026',
      category: 'purchase_plan',
      title: '2026Q3 猕猴桃采购计划',
      needsCrossChainData: 'KIWI-FARM-2026-S1',
      comparison: {
        question: '猕猴桃基地产量能满足需求吗？品质是否达标？',
        rules: [
          { label: '需求量', localValue: '30吨', remoteField: 'data.yieldForecast.estimatedTons', remoteUnit: '吨', op: 'lte', localNum: 30 },
          { label: 'A级比例', localValue: '>=65%', remoteField: 'data.yieldForecast.gradeA_ratio', remoteUnit: '', op: 'lte', localNum: 0.65, isPercent: true },
          { label: '干物质', localValue: '-', remoteField: 'data.cropCondition.dryMatter', remoteUnit: '%', op: 'info' }
        ]
      },
      data: {
        buyer: '华南生鲜集团',
        targetProduct: '翠香猕猴桃',
        requiredTons: 30,
        gradeRequirement: 'A级>=65%',
        deliveryWindow: '2026-09-10 ~ 2026-09-25',
        budgetPerKg: 12.0,
        budgetUnit: '元/kg',
        note: '需跨链查询猕猴桃基地产量和干物质数据'
      }
    }
  ],
  'processing': [
    {
      recordId: 'FISCO-QC-INSPECT-JUICE-0301',
      category: 'qc_inspection',
      title: '浓缩苹果汁质量抽检单',
      needsCrossChainData: 'JUICE-BATCH-20260301',
      comparison: {
        question: '加工厂质检数据是否符合食品安全标准？',
        rules: [
          { label: '铅含量', localValue: '<0.05mg/kg', remoteField: 'data.qualityTest.leadContent', remoteUnit: 'mg/kg', op: 'gte', localNum: 0.05 },
          { label: '微生物', localValue: '<100CFU/mL', remoteField: 'data.qualityTest.microbialCount', remoteUnit: 'CFU/mL', op: 'gte', localNum: 100 },
          { label: '杀菌温度', localValue: '>=121°C', remoteField: 'data.processing.pasteurizationTemp', remoteUnit: '°C', op: 'lte', localNum: 121 },
          { label: '原料来源', localValue: '-', remoteField: 'data.rawMaterial.sourceFarm', op: 'info' }
        ]
      },
      data: {
        inspector: '市食品监督管理局',
        inspectionType: '例行抽检',
        targetProduct: '浓缩苹果汁 AJC-70',
        sampleCount: 5,
        sampleDate: '2026-03-08',
        acceptanceCriteria: {
          leadContent: { limit: 0.05, unit: 'mg/kg', op: '<', standard: 'GB 2762-2022' },
          microbialCount: { limit: 100, unit: 'CFU/mL', op: '<', standard: 'GB 4789.2' },
          pasteurizationTemp: { limit: 121, unit: '°C', op: '>=', standard: 'GB 7101-2022' },
          pesticideResidue: { limit: '合格', standard: 'GB 2763-2021' }
        },
        status: '待获取加工链数据',
        note: '需跨链获取加工厂原料来源、质检报告'
      }
    },
    {
      recordId: 'FISCO-QC-INSPECT-DRIED-0305',
      category: 'qc_inspection',
      title: '猕猴桃干质量抽检单',
      needsCrossChainData: 'DRIED-BATCH-20260305',
      comparison: {
        question: '猕猴桃干加工参数是否合规？',
        rules: [
          { label: 'SO2残留', localValue: '<0.1g/kg', remoteField: 'data.qualityTest.sulfurDioxide', remoteUnit: 'g/kg', op: 'gte', localNum: 0.1 },
          { label: '水分', localValue: '<16%', remoteField: 'data.qualityTest.moisture', remoteUnit: '%', op: 'gte', localNum: 16 },
          { label: '色泽评分', localValue: '>=4.0', remoteField: 'data.qualityTest.colorScore', remoteUnit: '', op: 'lte', localNum: 4.0 }
        ]
      },
      data: {
        inspector: '市食品监督管理局',
        inspectionType: '例行抽检',
        targetProduct: '猕猴桃干 DKF-01',
        sampleCount: 3,
        sampleDate: '2026-03-10',
        acceptanceCriteria: {
          sulfurDioxide: { limit: 0.1, unit: 'g/kg', op: '<', standard: 'GB 2760-2024' },
          moisture: { limit: 16, unit: '%', op: '<', standard: 'GB/T 16325' },
          colorScore: { limit: 4.0, unit: '', op: '>=', standard: '企业内控标准' }
        },
        status: '待获取加工链数据',
        note: '需跨链获取加工参数和原料检验数据'
      }
    }
  ],
  'safety-trace': [
    {
      recordId: 'FISCO-COMPLAINT-20260315',
      category: 'consumer_complaint',
      title: '消费者投诉：苹果汁异味',
      needsCrossChainData: 'SAFETY-TRACE-20260315',
      comparison: {
        question: '逐环节倒追4步：零售→运输→加工→种植，定位问题环节',
        rules: []
      },
      data: {
        complainant: '消费者张某',
        product: '绿源浓缩苹果汁 250mL',
        purchaseBatch: 'JC-GZ-0312-A05',
        purchaseDate: '2026-03-13',
        complaint: '开封后有异味，口感异常',
        severity: '高',
        regulatoryAction: '启动全链追溯',
        note: '需跨链倒追：零售→运输→加工→种植'
      }
    },
    {
      recordId: 'FISCO-RECALL-ALERT-0315',
      category: 'recall_alert',
      title: '召回预警通知',
      needsCrossChainData: null,
      data: {
        issuer: '市食品监督管理局',
        alertLevel: '二级',
        relatedBatch: 'JC-GZ-0312-A05',
        scope: '广州天河区',
        action: '暂停销售，等待追溯结果',
        deadline: '2026-03-17T18:00:00Z'
      }
    }
  ]
};

/** 获取所有场景中所有记录的扁平列表 */
export function getAllSampleRecords() {
  return SCENARIOS.flatMap((s) => s.records);
}

/** 根据场景 ID 获取场景 */
export function getScenarioById(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}
