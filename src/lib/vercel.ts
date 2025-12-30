/**
 * Vercel deployment integration
 * Creates Vercel projects and triggers deployments via REST API
 */

const VERCEL_API = "https://api.vercel.com";

export interface VercelProjectOptions {
  projectName: string;
  teamId?: string;
  framework?: string;
  gitRepository?: {
    type: "github";
    repo: string; // format: "owner/repo"
  };
  environmentVariables?: Array<{
    key: string;
    value: string;
    target: ("production" | "preview" | "development")[];
  }>;
}

export interface VercelProjectResult {
  projectId: string;
  projectName: string;
  projectUrl: string;
  created: boolean;
}

export interface VercelDeploymentResult {
  deploymentId: string;
  deploymentUrl: string;
  inspectorUrl: string;
  status: string;
}

export interface EnsureVercelProjectAndDeployResult {
  project: VercelProjectResult;
  deployment: VercelDeploymentResult | null;
}

// Vercel API response types
interface VercelProjectResponse {
  id: string;
  name: string;
  accountId: string;
}

interface VercelDeploymentResponse {
  id: string;
  url: string;
  inspectorUrl?: string;
  readyState?: string;
  status?: string;
  errorMessage?: string;
}

function getVercelToken(): string {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new Error("VERCEL_TOKEN environment variable is required");
  }
  return token;
}

function getVercelHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getVercelToken()}`,
    "Content-Type": "application/json",
  };
}

function getTeamParam(teamId?: string): string {
  return teamId ? `?teamId=${teamId}` : "";
}

/**
 * Check if a Vercel project exists by name
 */
async function projectExists(
  projectName: string,
  teamId?: string
): Promise<{ exists: boolean; projectId?: string }> {
  const res = await fetch(
    `${VERCEL_API}/v9/projects/${encodeURIComponent(projectName)}${getTeamParam(teamId)}`,
    { headers: getVercelHeaders() }
  );

  if (res.ok) {
    const data = (await res.json()) as VercelProjectResponse;
    return { exists: true, projectId: data.id };
  }

  if (res.status === 404) {
    return { exists: false };
  }

  const error = await res.text();
  throw new Error(`Failed to check project existence: ${res.status} - ${error}`);
}

/**
 * Create a new Vercel project
 */
async function createProject(options: VercelProjectOptions, teamId?: string): Promise<VercelProjectResult> {
  const body: Record<string, unknown> = {
    name: options.projectName,
    framework: options.framework ?? "nuxtjs",
  };

  // Link to GitHub repository if provided
  if (options.gitRepository) {
    body.gitRepository = options.gitRepository;
  }

  // Add environment variables if provided
  if (options.environmentVariables && options.environmentVariables.length > 0) {
    body.environmentVariables = options.environmentVariables;
  }

  const res = await fetch(`${VERCEL_API}/v10/projects${getTeamParam(teamId)}`, {
    method: "POST",
    headers: getVercelHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to create Vercel project: ${res.status} - ${error}`);
  }

  const data = (await res.json()) as VercelProjectResponse;

  return {
    projectId: data.id,
    projectName: data.name,
    projectUrl: `https://vercel.com/${teamId ?? data.accountId}/${data.name}`,
    created: true,
  };
}

/**
 * Ensure a Vercel project exists (create if not)
 */
async function ensureProject(
  options: VercelProjectOptions,
  teamId?: string
): Promise<VercelProjectResult> {
  const { exists, projectId } = await projectExists(options.projectName, teamId);

  if (exists && projectId) {
    return {
      projectId,
      projectName: options.projectName,
      projectUrl: `https://vercel.com/${teamId ?? "~"}/${options.projectName}`,
      created: false,
    };
  }

  return createProject(options, teamId);
}

/**
 * Trigger a deployment for a project
 * This creates a deployment hook trigger or uses the deployments API
 */
async function triggerDeployment(
  projectId: string,
  projectName: string,
  gitRepo: string,
  teamId?: string
): Promise<VercelDeploymentResult> {
  // Use the deployments API to trigger a new deployment
  const body = {
    name: projectName,
    project: projectId,
    gitSource: {
      type: "github",
      repo: gitRepo,
      ref: "main",
    },
  };

  const res = await fetch(`${VERCEL_API}/v13/deployments${getTeamParam(teamId)}`, {
    method: "POST",
    headers: getVercelHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to trigger deployment: ${res.status} - ${error}`);
  }

  const data = (await res.json()) as VercelDeploymentResponse;

  return {
    deploymentId: data.id,
    deploymentUrl: `https://${data.url}`,
    inspectorUrl: data.inspectorUrl ?? `https://vercel.com/${teamId ?? "~"}/${projectName}/${data.id}`,
    status: data.readyState ?? data.status ?? "QUEUED",
  };
}

/**
 * Get deployment status
 */
export async function getDeploymentStatus(
  deploymentId: string,
  teamId?: string
): Promise<{ status: string; url?: string; error?: string }> {
  const res = await fetch(
    `${VERCEL_API}/v13/deployments/${deploymentId}${getTeamParam(teamId)}`,
    { headers: getVercelHeaders() }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to get deployment status: ${res.status} - ${error}`);
  }

  const data = (await res.json()) as VercelDeploymentResponse;

  return {
    status: data.readyState ?? data.status ?? "UNKNOWN",
    url: data.url ? `https://${data.url}` : undefined,
    error: data.errorMessage,
  };
}

/**
 * Main function: ensure Vercel project exists and trigger deployment
 */
export async function ensureVercelProjectAndDeploy(
  options: VercelProjectOptions & { teamId?: string }
): Promise<EnsureVercelProjectAndDeployResult> {
  const { teamId, ...projectOptions } = options;

  const project = await ensureProject(projectOptions, teamId);

  // Only trigger deployment if we have a git repository configured
  let deployment: VercelDeploymentResult | null = null;

  if (projectOptions.gitRepository) {
    try {
      deployment = await triggerDeployment(
        project.projectId,
        project.projectName,
        projectOptions.gitRepository.repo,
        teamId
      );
    } catch (error) {
      // Deployment trigger failed, but project was created
      // This might happen if the repo isn't fully set up yet
      console.warn("Deployment trigger failed:", error);
    }
  }

  return { project, deployment };
}

/**
 * Link an existing project to a GitHub repository
 */
export async function linkProjectToGitHub(
  projectId: string,
  gitRepo: string,
  teamId?: string
): Promise<void> {
  const res = await fetch(
    `${VERCEL_API}/v9/projects/${projectId}/link${getTeamParam(teamId)}`,
    {
      method: "POST",
      headers: getVercelHeaders(),
      body: JSON.stringify({
        type: "github",
        repo: gitRepo,
      }),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to link project to GitHub: ${res.status} - ${error}`);
  }
}
