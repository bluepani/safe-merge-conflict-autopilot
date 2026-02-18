export async function githubRequest({ token, method, url, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API ${method} ${url} failed (${response.status}): ${JSON.stringify(data)}`
    );
  }

  return data;
}

export async function postPullRequestComment({ token, owner, repo, pullNumber, body }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${pullNumber}/comments`;
  return githubRequest({
    token,
    method: "POST",
    url,
    body: { body }
  });
}

