const test = require('node:test');
const assert = require('node:assert');
const logger = require('../../src/infra/logger');

test('logger.safeStringify', async (t) => {
  await t.test('stringifies normal object', () => {
    const obj = { key: 'value', num: 123 };
    assert.strictEqual(logger.safeStringify(obj), '{"key":"value","num":123}');
  });

  await t.test('stringifies array', () => {
    const arr = [1, 'two', { three: 3 }];
    assert.strictEqual(logger.safeStringify(arr), '[1,"two",{"three":3}]');
  });

  await t.test('stringifies primitive values', () => {
    assert.strictEqual(logger.safeStringify('string'), '"string"');
    assert.strictEqual(logger.safeStringify(123), '123');
    assert.strictEqual(logger.safeStringify(true), 'true');
    assert.strictEqual(logger.safeStringify(null), 'null');
  });

  await t.test('handles circular JSON objects gracefully', () => {
    const circularObj = {};
    circularObj.self = circularObj;

    assert.strictEqual(
      logger.safeStringify(circularObj),
      '{"message":"Unserializable payload"}'
    );
  });
});
