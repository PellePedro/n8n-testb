import { Get, Post, RestController, Param, Body } from '@n8n/decorators';
import { Service } from '@n8n/di';
import type { Request, Response } from 'express';
import {
	Workflow,
	type INode,
	type IConnections,
	type INodeExecutionData,
} from 'n8n-workflow';

interface DataFlowRequest {
	nodes: Array<{
		name: string;
		type: string;
		data?: INodeExecutionData[];
	}>;
	connections: IConnections;
}

interface DataFlowResult {
	nodeOutputs: Record<string, INodeExecutionData[][]>;
	executionOrder: string[];
	success: boolean;
}

/**
 * Scenario 2: Node Data Flow
 *
 * Simulates data passing between nodes to validate:
 * - Output from one node becomes input to connected nodes
 * - Multiple inputs merged if node has multiple connections
 * - Empty data array if no input
 */
@Service()
class DataFlowService {
	simulate(request: DataFlowRequest): DataFlowResult {
		const nodeOutputs: Record<string, INodeExecutionData[][]> = {};
		const executionOrder: string[] = [];

		// Build adjacency from connections (source → destinations)
		const adjacency = new Map<string, string[]>();
		const inDegree = new Map<string, number>();

		for (const node of request.nodes) {
			adjacency.set(node.name, []);
			inDegree.set(node.name, 0);
		}

		for (const [sourceName, outputs] of Object.entries(request.connections)) {
			if (outputs.main) {
				for (const connections of outputs.main) {
					if (Array.isArray(connections)) {
						for (const conn of connections as Array<{ node: string }>) {
							adjacency.get(sourceName)?.push(conn.node);
							inDegree.set(conn.node, (inDegree.get(conn.node) ?? 0) + 1);
						}
					}
				}
			}
		}

		// Topological sort (Kahn's algorithm)
		const queue: string[] = [];
		for (const [name, deg] of inDegree) {
			if (deg === 0) queue.push(name);
		}

		while (queue.length > 0) {
			const current = queue.shift()!;
			executionOrder.push(current);

			// Get input data for this node (from parent outputs)
			const nodeDef = request.nodes.find((n) => n.name === current);
			const inputData: INodeExecutionData[] = [];

			// Collect data from all parents
			for (const [sourceName, outputs] of Object.entries(request.connections)) {
				if (outputs.main) {
					for (const connections of outputs.main) {
						if (Array.isArray(connections)) {
							for (const conn of connections as Array<{ node: string }>) {
								if (conn.node === current && nodeOutputs[sourceName]) {
									const sourceOutput = nodeOutputs[sourceName][0] ?? [];
									inputData.push(...sourceOutput);
								}
							}
						}
					}
				}
			}

			// Simulate node execution: use provided data or pass through input
			const output: INodeExecutionData[] =
				nodeDef?.data ?? (inputData.length > 0 ? inputData : [{ json: {} }]);

			nodeOutputs[current] = [output];

			// Process neighbors
			for (const neighbor of adjacency.get(current) ?? []) {
				const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
				inDegree.set(neighbor, newDeg);
				if (newDeg === 0) queue.push(neighbor);
			}
		}

		return { nodeOutputs, executionOrder, success: true };
	}
}

@RestController('/scenario/data-flow')
export class ScenarioDataFlowController {
	constructor(private readonly service: DataFlowService) {}

	/** POST /scenario/data-flow/simulate - Simulate data flow through nodes */
	@Post('/simulate', { skipAuth: true })
	async simulate(req: Request, _res: Response) {
		const body = req.body as DataFlowRequest;
		return this.service.simulate(body);
	}

	/** GET /scenario/data-flow/validate/{nodeCount} - Validate chain of N nodes */
	@Get('/validate/:nodeCount', { skipAuth: true })
	async validateChain(_req: Request, _res: Response, @Param('nodeCount') nodeCount: string) {
		const count = Number(nodeCount);
		const nodes = [];
		const connections: Record<string, unknown> = {};

		for (let i = 0; i < count; i++) {
			nodes.push({
				name: `Node_${i}`,
				type: 'set',
				data: [{ json: { step: i, value: `output-${i}` } }],
			});
			if (i < count - 1) {
				connections[`Node_${i}`] = {
					main: [[{ node: `Node_${i + 1}`, type: 'main', index: 0 }]],
				};
			}
		}

		return this.service.simulate({ nodes, connections: connections as IConnections });
	}
}
