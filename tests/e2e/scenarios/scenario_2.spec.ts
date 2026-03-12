import { test, expect } from '../../../packages/testing/playwright/fixtures/base';

/**
 * Scenario 2: Node Data Flow
 *
 * Tests the new data flow simulation endpoints:
 * - POST /rest/scenario/data-flow/simulate
 * - GET /rest/scenario/data-flow/validate/{nodeCount}
 */
test.describe('Scenario 2: Node Data Flow', () => {
	test('should pass data from node to node', async ({ api }) => {
		const response = await api.request.post('/rest/scenario/data-flow/simulate', {
			data: {
				nodes: [
					{ name: 'Start', type: 'trigger', data: [{ json: { name: 'Alice' } }] },
					{ name: 'Process', type: 'set' },
				],
				connections: {
					Start: { main: [[{ node: 'Process', type: 'main', index: 0 }]] },
				},
			},
		});

		expect(response.ok()).toBeTruthy();
		const body = await response.json();
		const result = body.data ?? body;

		expect(result.nodeOutputs.Process[0][0].json.name).toBe('Alice');
	});

	test('should preserve output structure through chain', async ({ api }) => {
		const response = await api.request.post('/rest/scenario/data-flow/simulate', {
			data: {
				nodes: [
					{ name: 'A', type: 'set', data: [{ json: { value: 42 } }] },
					{ name: 'B', type: 'set' },
					{ name: 'C', type: 'set' },
				],
				connections: {
					A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
					B: { main: [[{ node: 'C', type: 'main', index: 0 }]] },
				},
			},
		});

		const body = await response.json();
		const result = body.data ?? body;

		// Data should flow A → B → C, preserving the original value
		expect(result.nodeOutputs.C[0][0].json.value).toBe(42);
		expect(result.executionOrder).toEqual(['A', 'B', 'C']);
	});

	test('should handle multiple nodes in a chain via validate endpoint', async ({ api }) => {
		const response = await api.request.get('/rest/scenario/data-flow/validate/5');

		expect(response.ok()).toBeTruthy();
		const body = await response.json();
		const result = body.data ?? body;

		expect(result.executionOrder).toHaveLength(5);
		expect(result.success).toBe(true);

		// Last node should have output from previous node
		expect(result.nodeOutputs.Node_4).toBeTruthy();
	});

	test('should handle empty input with default empty json', async ({ api }) => {
		const response = await api.request.post('/rest/scenario/data-flow/simulate', {
			data: {
				nodes: [
					{ name: 'Isolated', type: 'set' },
				],
				connections: {},
			},
		});

		const body = await response.json();
		const result = body.data ?? body;

		// Node with no input should get empty json
		expect(result.nodeOutputs.Isolated[0][0].json).toEqual({});
	});

	test('should merge data from multiple inputs', async ({ api }) => {
		const response = await api.request.post('/rest/scenario/data-flow/simulate', {
			data: {
				nodes: [
					{ name: 'Source1', type: 'set', data: [{ json: { from: 'source1' } }] },
					{ name: 'Source2', type: 'set', data: [{ json: { from: 'source2' } }] },
					{ name: 'Merge', type: 'set' },
				],
				connections: {
					Source1: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
					Source2: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
				},
			},
		});

		const body = await response.json();
		const result = body.data ?? body;

		// Merge node should receive data from both sources
		const mergeOutput = result.nodeOutputs.Merge[0];
		expect(mergeOutput.length).toBe(2);
	});
});
