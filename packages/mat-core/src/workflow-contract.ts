export interface RemoteWorkflowDescriptor {
  id: string
  version: string
  inputSchema: string
  outputSchema: string
  artifactManifestSchema: string
}

export interface RemoteWorkflowRequest {
  workflow: RemoteWorkflowDescriptor
  clusterId: string
  workdir: string
  inputs: Record<string, unknown>
  requestedOutputs?: string[]
}

export interface RemoteWorkflowResult {
  executionId: string
  workdir: string
  result?: Record<string, unknown>
  artifacts?: ArtifactManifestEntry[]
}

export interface RemoteWorkflowAdapter {
  readonly workflow: RemoteWorkflowDescriptor
  run(request: RemoteWorkflowRequest): Promise<RemoteWorkflowResult>
}

export interface ArtifactManifestEntry {
  path: string
  size: number
  kind: 'file' | 'directory'
  localPolicy: 'sync' | 'remote-only'
}

export const GAUSSIAN_MAT_WORKFLOW: RemoteWorkflowDescriptor = {
  id: 'gaussian-opt-freq',
  version: '1',
  inputSchema: 'gaussian.pre.v1',
  outputSchema: 'calcflow.result.v1',
  artifactManifestSchema: 'mat.artifacts.v1',
}

export function createGaussianMatAdapter(
  execute: (request: RemoteWorkflowRequest) => Promise<RemoteWorkflowResult>,
): RemoteWorkflowAdapter {
  return {
    workflow: GAUSSIAN_MAT_WORKFLOW,
    run(request) {
      if (request.workflow.id !== GAUSSIAN_MAT_WORKFLOW.id) throw new Error('unsupported Gaussian workflow')
      return execute(createRemoteWorkflowRequest(request))
    },
  }
}

/**
 * VASP/matstream 工作流描述符。执行形态与 gaussian 不同（作业内整链，
 * 见 ENGINE_BOUNDARY_NOTES.vaspNotes）：inputs = {tasks, structure, structure_filename,
 * preset, mode}；outputSchema 锚定 matstream 的收割契约（matstream.json 单 JSON）。
 */
export const VASP_MAT_WORKFLOW: RemoteWorkflowDescriptor = {
  id: 'vasp-matstream-chain',
  version: '1',
  inputSchema: 'vasp.matstream.pre.v1',
  outputSchema: 'matstream.result.v1',
  artifactManifestSchema: 'mat.artifacts.v1',
}

export function createVaspMatAdapter(
  execute: (request: RemoteWorkflowRequest) => Promise<RemoteWorkflowResult>,
): RemoteWorkflowAdapter {
  return {
    workflow: VASP_MAT_WORKFLOW,
    run(request) {
      if (request.workflow.id !== VASP_MAT_WORKFLOW.id) throw new Error('unsupported VASP workflow')
      return execute(createRemoteWorkflowRequest(request))
    },
  }
}

export function createRemoteWorkflowRequest(input: RemoteWorkflowRequest): RemoteWorkflowRequest {
  return {
    workflow: { ...input.workflow },
    clusterId: input.clusterId,
    workdir: input.workdir,
    inputs: { ...input.inputs },
    ...(input.requestedOutputs === undefined ? {} : { requestedOutputs: [...input.requestedOutputs] }),
  }
}

export function createArtifactManifest(
  entries: Array<{ path: string; size: number; kind?: 'file' | 'directory' }>,
  options: { maxAutoSyncBytes: number },
): ArtifactManifestEntry[] {
  return entries.map((entry) => ({
    path: entry.path,
    size: entry.size,
    kind: entry.kind ?? 'file',
    localPolicy: entry.kind === 'directory' || entry.size > options.maxAutoSyncBytes ? 'remote-only' : 'sync',
  }))
}
