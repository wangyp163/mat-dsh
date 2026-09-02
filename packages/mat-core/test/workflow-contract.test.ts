import { describe, expect, it } from 'vitest'
import {
  GAUSSIAN_MAT_WORKFLOW,
  createArtifactManifest,
  createRemoteWorkflowRequest,
  createGaussianMatAdapter,
} from '../src/workflow-contract'

describe('HPC remote workflow contract', () => {
  it('describes a versioned server-side workflow without bundling implementation', () => {
    expect(GAUSSIAN_MAT_WORKFLOW).toEqual({
      id: 'gaussian-opt-freq',
      version: '1',
      inputSchema: 'gaussian.pre.v1',
      outputSchema: 'calcflow.result.v1',
      artifactManifestSchema: 'mat.artifacts.v1',
    })
  })

  it('builds a declarative request containing inputs, not a workflow package', () => {
    expect(createRemoteWorkflowRequest({
      workflow: GAUSSIAN_MAT_WORKFLOW,
      clusterId: '11250',
      workdir: '/home/u/job',
      inputs: { 'pre.json': { schema_version: 'gaussian_workflow.pre.v1' } },
      requestedOutputs: ['energy', 'converged'],
    })).toEqual({
      workflow: GAUSSIAN_MAT_WORKFLOW,
      clusterId: '11250',
      workdir: '/home/u/job',
      inputs: { 'pre.json': { schema_version: 'gaussian_workflow.pre.v1' } },
      requestedOutputs: ['energy', 'converged'],
    })
  })

  it('executes through a local adapter while passing only declarative controls', async () => {
    const seen: unknown[] = []
    const adapter = createGaussianMatAdapter(async (request) => {
      seen.push(request)
      return { executionId: '700', workdir: request.workdir }
    })
    const request = createRemoteWorkflowRequest({
      workflow: GAUSSIAN_MAT_WORKFLOW,
      clusterId: '11250',
      workdir: '/home/u/job',
      inputs: {
        task: 'opt',
        structure: '1\\nH 0 0 0\\n',
        'pre.json': { schema_version: 'gaussian_workflow.pre.v1' },
        'run.json': { slurm: { partition: 'Agent0' } },
        'post.json': {},
      },
    })

    await expect(adapter.run(request)).resolves.toEqual({ executionId: '700', workdir: '/home/u/job' })
    expect(seen).toEqual([request])
    expect(JSON.stringify(seen)).not.toContain('workflowPackage')
  })

  it('normalizes artifact manifest entries and assigns sync policy by size', () => {
    expect(createArtifactManifest([
      { path: '/home/u/job/result.json', size: 512 },
      { path: '/home/u/job/checkpoint.chk', size: 2000 },
    ], { maxAutoSyncBytes: 1024 })).toEqual([
      { path: '/home/u/job/result.json', size: 512, kind: 'file', localPolicy: 'sync' },
      { path: '/home/u/job/checkpoint.chk', size: 2000, kind: 'file', localPolicy: 'remote-only' },
    ])
  })
})
