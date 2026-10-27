import test from 'node:test';import assert from 'node:assert/strict';import {purchaseSchema,saleSchema,masterSchemas} from '../src/validators/schemas.js';
test('oil type accepts purchase and selling prices',()=>{const x=masterSchemas.oilType.parse({name:'Groundnut Oil',code:'GNO',defaultPurchasePricePerKg:120,sellingPricePerKg:140});assert.equal(x.sellingPricePerKg,140)});
test('purchase validation accepts expected fields',()=>{const x=purchaseSchema.parse({manufacturerId:101,oilTypeId:101,quantityKg:1000,purchasePricePerKg:120,advanceAmount:30000,purchaseDate:'2026-10-26'});assert.equal(x.quantityKg,1000)});
test('sale validation requires at least one item',()=>{assert.throws(()=>saleSchema.parse({items:[]}))});
test('sale accepts optional per-item selling override',()=>{const x=saleSchema.parse({items:[{oilTypeId:101,quantityKg:2,sellingPricePerKg:145}]});assert.equal(x.items[0].sellingPricePerKg,145)});
