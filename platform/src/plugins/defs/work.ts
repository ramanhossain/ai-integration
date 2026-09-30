import type { PluginDef } from "../types";
import { P, bool, json, num, path, q, urlField } from "./_shared";

// Ontwikkeling, projectbeheer en productiviteit.
export const WORK: PluginDef[] = [
  {
    id: "github", name: "GitHub", category: "Ontwikkeling", description: "Issues, repositories, pull requests en releases", color: "#24292f",
    website: "https://github.com", docs: "https://docs.github.com/rest",
    baseUrl: "https://api.github.com", auth: { type: "bearer", label: "Personal access token (fine-grained)" }, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, test: "user.me",
    operations: [
      { id: "issue.create", resource: "Issue", label: "Issue maken", method: "POST", path: "/repos/{{owner}}/{{repo}}/issues", params: [path("owner", "Eigenaar"), path("repo", "Repository"), P("title", "Titel", { required: true }), P("body", "Omschrijving", { type: "text" }), P("labels", "Labels", { format: "list" }), P("assignees", "Toegewezen aan", { format: "list" })] },
      { id: "issue.get", resource: "Issue", label: "Issue ophalen", method: "GET", path: "/repos/{{owner}}/{{repo}}/issues/{{number}}", params: [path("owner", "Eigenaar"), path("repo", "Repository"), path("number", "Nummer")] },
      { id: "issue.list", resource: "Issue", label: "Issues", method: "GET", path: "/repos/{{owner}}/{{repo}}/issues", params: [path("owner", "Eigenaar"), path("repo", "Repository"), q("state", "Status", { default: "open", options: ["open", "closed", "all"] }), q("labels", "Labels"), q("per_page", "Aantal", { default: "30" })] },
      { id: "issue.update", resource: "Issue", label: "Issue wijzigen", method: "PATCH", path: "/repos/{{owner}}/{{repo}}/issues/{{number}}", params: [path("owner", "Eigenaar"), path("repo", "Repository"), path("number", "Nummer"), P("title", "Titel"), P("body", "Omschrijving", { type: "text" }), P("state", "Status", { options: ["open", "closed"] }), P("labels", "Labels", { format: "list" })] },
      { id: "issue.comment", resource: "Issue", label: "Reactie plaatsen", method: "POST", path: "/repos/{{owner}}/{{repo}}/issues/{{number}}/comments", params: [path("owner", "Eigenaar"), path("repo", "Repository"), path("number", "Nummer"), P("body", "Reactie", { type: "text", required: true })] },
      { id: "pr.list", resource: "Pull request", label: "Pull requests", method: "GET", path: "/repos/{{owner}}/{{repo}}/pulls", params: [path("owner", "Eigenaar"), path("repo", "Repository"), q("state", "Status", { default: "open", options: ["open", "closed", "all"] })] },
      { id: "pr.create", resource: "Pull request", label: "Pull request maken", method: "POST", path: "/repos/{{owner}}/{{repo}}/pulls", params: [path("owner", "Eigenaar"), path("repo", "Repository"), P("title", "Titel", { required: true }), P("head", "Van branch", { required: true }), P("base", "Naar branch", { default: "main" }), P("body", "Omschrijving", { type: "text" })] },
      { id: "release.create", resource: "Release", label: "Release maken", method: "POST", path: "/repos/{{owner}}/{{repo}}/releases", params: [path("owner", "Eigenaar"), path("repo", "Repository"), P("tag_name", "Tag", { required: true }), P("name", "Naam"), P("body", "Release notes", { type: "text" }), bool("draft", "Concept", { default: false }), bool("prerelease", "Pre-release", { default: false })] },
      { id: "file.get", resource: "Bestand", label: "Bestand lezen", method: "GET", path: "/repos/{{owner}}/{{repo}}/contents/{{filePath}}", params: [path("owner", "Eigenaar"), path("repo", "Repository"), path("filePath", "Pad", { format: "raw" }), q("ref", "Branch/tag")] },
      { id: "workflow.dispatch", resource: "Actions", label: "Workflow starten", method: "POST", path: "/repos/{{owner}}/{{repo}}/actions/workflows/{{workflow}}/dispatches", params: [path("owner", "Eigenaar"), path("repo", "Repository"), path("workflow", "Workflow (bestand of ID)", { placeholder: "deploy.yml" }), P("ref", "Branch", { default: "main" }), json("inputs", "Inputs")] },
      { id: "repo.get", resource: "Repository", label: "Repository-info", method: "GET", path: "/repos/{{owner}}/{{repo}}", params: [path("owner", "Eigenaar"), path("repo", "Repository")] },
      { id: "repo.list", resource: "Repository", label: "Mijn repositories", method: "GET", path: "/user/repos", params: [q("per_page", "Aantal", { default: "50" }), q("sort", "Sorteren", { default: "updated" })] },
      { id: "user.me", resource: "Account", label: "Mijn account", method: "GET", path: "/user" }
    ]
  },
  {
    id: "gitlab", name: "GitLab", category: "Ontwikkeling", description: "Issues, projecten en releases", color: "#fc6d26",
    website: "https://gitlab.com", docs: "https://docs.gitlab.com/ee/api/rest/",
    baseUrl: "https://{{host}}/api/v4", auth: { type: "headers", headers: { "PRIVATE-TOKEN": "{{token}}" }, fields: [{ key: "token", label: "Access token", secret: true }] },
    fields: [{ key: "host", label: "Host", default: "gitlab.com" }], test: "user.me",
    operations: [
      { id: "issue.create", resource: "Issue", label: "Issue maken", method: "POST", path: "/projects/{{project}}/issues", params: [path("project", "Project (ID of groep/naam)"), P("title", "Titel", { required: true }), P("description", "Omschrijving", { type: "text" }), P("labels", "Labels (komma)")] },
      { id: "issue.list", resource: "Issue", label: "Issues", method: "GET", path: "/projects/{{project}}/issues", params: [path("project", "Project"), q("state", "Status", { default: "opened", options: ["opened", "closed", "all"] })] },
      { id: "issue.get", resource: "Issue", label: "Issue ophalen", method: "GET", path: "/projects/{{project}}/issues/{{iid}}", params: [path("project", "Project"), path("iid", "Issue-nummer")] },
      { id: "issue.note", resource: "Issue", label: "Reactie plaatsen", method: "POST", path: "/projects/{{project}}/issues/{{iid}}/notes", params: [path("project", "Project"), path("iid", "Issue-nummer"), P("body", "Reactie", { type: "text", required: true })] },
      { id: "mr.list", resource: "Merge request", label: "Merge requests", method: "GET", path: "/projects/{{project}}/merge_requests", params: [path("project", "Project"), q("state", "Status", { default: "opened" })] },
      { id: "pipeline.run", resource: "Pipeline", label: "Pipeline starten", method: "POST", path: "/projects/{{project}}/pipeline", params: [path("project", "Project"), P("ref", "Branch", { default: "main" }), json("variables", "Variabelen", { placeholder: '[{"key":"ENV","value":"test"}]' })] },
      { id: "release.create", resource: "Release", label: "Release maken", method: "POST", path: "/projects/{{project}}/releases", params: [path("project", "Project"), P("tag_name", "Tag", { required: true }), P("name", "Naam"), P("description", "Release notes", { type: "text" }), P("ref", "Van (branch/commit)")] },
      { id: "project.get", resource: "Project", label: "Project-info", method: "GET", path: "/projects/{{project}}", params: [path("project", "Project")] },
      { id: "user.me", resource: "Account", label: "Mijn account", method: "GET", path: "/user" }
    ]
  },
  {
    id: "bitbucket", name: "Bitbucket", category: "Ontwikkeling", description: "Repositories en pull requests", color: "#0052cc",
    website: "https://bitbucket.org", docs: "https://developer.atlassian.com/cloud/bitbucket/rest/",
    baseUrl: "https://api.bitbucket.org/2.0", auth: { type: "basic", userLabel: "Gebruikersnaam", passLabel: "App-wachtwoord" }, test: "user.me",
    operations: [
      { id: "repo.list", resource: "Repository", label: "Repositories", method: "GET", path: "/repositories/{{workspace}}", output: "values", params: [path("workspace", "Workspace")] },
      { id: "pr.list", resource: "Pull request", label: "Pull requests", method: "GET", path: "/repositories/{{workspace}}/{{repo}}/pullrequests", output: "values", params: [path("workspace", "Workspace"), path("repo", "Repository"), q("state", "Status", { default: "OPEN" })] },
      { id: "pr.create", resource: "Pull request", label: "Pull request maken", method: "POST", path: "/repositories/{{workspace}}/{{repo}}/pullrequests", body: { title: "{{title}}", source: { branch: { name: "{{source}}" } }, destination: { branch: { name: "{{destination}}" } }, description: "{{description}}" },
        params: [path("workspace", "Workspace"), path("repo", "Repository"), P("title", "Titel", { required: true }), P("source", "Van branch", { required: true }), P("destination", "Naar branch", { default: "main" }), P("description", "Omschrijving", { type: "text" })] },
      { id: "user.me", resource: "Account", label: "Mijn account", method: "GET", path: "/user" }
    ]
  },
  {
    id: "jira", name: "Jira Software", category: "Projectbeheer", description: "Issues, reacties en overgangen (Jira Cloud)", color: "#0052cc",
    website: "https://atlassian.com/software/jira", docs: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
    baseUrl: "https://{{domain}}/rest/api/3", auth: { type: "basic", userLabel: "E-mail (Atlassian-account)", passLabel: "API-token", help: "Maak een API-token op id.atlassian.com → Security → API tokens." },
    fields: [{ key: "domain", label: "Jira-domein", placeholder: "bedrijf.atlassian.net" }], test: "myself",
    operations: [
      { id: "issue.create", resource: "Issue", label: "Issue maken", method: "POST", path: "/issue",
        params: [P("fields.project.key", "Projectsleutel", { required: true, placeholder: "OPS" }), P("fields.summary", "Samenvatting", { required: true }), P("fields.issuetype.name", "Type", { default: "Task", options: ["Task", "Bug", "Story", "Epic"] }), P("fields.description", "Omschrijving", { type: "text", format: "adf" }), P("fields.labels", "Labels", { format: "list" }), P("fields.priority.name", "Prioriteit", { options: ["Highest", "High", "Medium", "Low", "Lowest"] }), P("fields.assignee.accountId", "Toegewezen aan (account-ID)")] },
      { id: "issue.get", resource: "Issue", label: "Issue ophalen", method: "GET", path: "/issue/{{issueKey}}", params: [path("issueKey", "Issue-sleutel", { placeholder: "OPS-12" }), q("fields", "Velden")] },
      { id: "issue.search", resource: "Issue", label: "Zoeken (JQL)", method: "GET", path: "/search/jql", output: "issues", params: [q("jql", "JQL", { required: true, placeholder: "project = OPS AND status != Done ORDER BY created DESC" }), q("maxResults", "Aantal", { default: "50" }), q("fields", "Velden", { default: "summary,status,assignee,created,priority" })] },
      { id: "issue.update", resource: "Issue", label: "Issue bijwerken", method: "PUT", path: "/issue/{{issueKey}}", params: [path("issueKey", "Issue-sleutel"), P("fields.summary", "Samenvatting"), P("fields.description", "Omschrijving", { type: "text", format: "adf" }), P("fields.labels", "Labels", { format: "list" })] },
      { id: "issue.comment", resource: "Issue", label: "Reactie plaatsen", method: "POST", path: "/issue/{{issueKey}}/comment", params: [path("issueKey", "Issue-sleutel"), P("body", "Reactie", { type: "text", required: true, format: "adf" })] },
      { id: "issue.transitions", resource: "Issue", label: "Mogelijke overgangen", method: "GET", path: "/issue/{{issueKey}}/transitions", output: "transitions", params: [path("issueKey", "Issue-sleutel")] },
      { id: "issue.transition", resource: "Issue", label: "Status wijzigen (overgang)", method: "POST", path: "/issue/{{issueKey}}/transitions", body: { transition: { id: "{{transitionId}}" } }, params: [path("issueKey", "Issue-sleutel"), P("transitionId", "Overgang-ID", { required: true })] },
      { id: "issue.delete", resource: "Issue", label: "Issue verwijderen", method: "DELETE", path: "/issue/{{issueKey}}", params: [path("issueKey", "Issue-sleutel")] },
      { id: "project.list", resource: "Project", label: "Projecten", method: "GET", path: "/project/search", output: "values" },
      { id: "myself", resource: "Account", label: "Mijn account", method: "GET", path: "/myself" }
    ]
  },
  {
    id: "linear", name: "Linear", category: "Projectbeheer", description: "Issues en teams (GraphQL-API)", color: "#5e6ad2",
    website: "https://linear.app", docs: "https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
    baseUrl: "https://api.linear.app/graphql", auth: { type: "apiKey", in: "header", name: "Authorization", label: "Personal API-key" }, graphqlErrors: true, test: "viewer",
    operations: [
      { id: "issue.create", resource: "Issue", label: "Issue maken", method: "POST", path: "", output: "data.issueCreate.issue",
        body: { query: "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }", variables: { input: { teamId: "{{teamId}}", title: "{{title}}", description: "{{description}}", priority: "{{priority}}", assigneeId: "{{assigneeId}}" } } },
        params: [P("teamId", "Team-ID", { required: true }), P("title", "Titel", { required: true }), P("description", "Omschrijving (markdown)", { type: "text" }), num("priority", "Prioriteit (0-4)"), P("assigneeId", "Toegewezen aan (ID)")] },
      { id: "issue.update", resource: "Issue", label: "Issue bijwerken", method: "POST", path: "", output: "data.issueUpdate",
        body: { query: "mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title } } }", variables: { id: "{{id}}", input: { title: "{{title}}", stateId: "{{stateId}}", priority: "{{priority}}" } } },
        params: [P("id", "Issue-ID of sleutel", { required: true }), P("title", "Titel"), P("stateId", "Status-ID"), num("priority", "Prioriteit")] },
      { id: "issue.list", resource: "Issue", label: "Issues", method: "POST", path: "", output: "data.issues.nodes", body: { query: "query($first: Int) { issues(first: $first, orderBy: updatedAt) { nodes { id identifier title url state { name } assignee { name } } } }", variables: { first: "{{first}}" } }, params: [num("first", "Aantal", { default: 50 })] },
      { id: "team.list", resource: "Team", label: "Teams", method: "POST", path: "", output: "data.teams.nodes", body: { query: "{ teams { nodes { id name key } } }" } },
      { id: "graphql", resource: "GraphQL", label: "Eigen GraphQL-query", method: "POST", path: "", params: [P("query", "Query", { type: "text", required: true }), json("variables", "Variabelen")] },
      { id: "viewer", resource: "Account", label: "Mijn account", method: "POST", path: "", output: "data.viewer", body: { query: "{ viewer { id name email } }" } }
    ]
  },
  {
    id: "asana", name: "Asana", category: "Projectbeheer", description: "Taken, projecten en teams", color: "#f06a6a",
    website: "https://asana.com", docs: "https://developers.asana.com/reference",
    baseUrl: "https://app.asana.com/api/1.0", auth: { type: "bearer", label: "Personal access token" }, test: "me",
    operations: [
      { id: "task.create", resource: "Taak", label: "Taak maken", method: "POST", path: "/tasks", output: "data", params: [P("data.name", "Naam", { required: true }), P("data.notes", "Notities", { type: "text" }), P("data.projects", "Project-ID's", { format: "list" }), P("data.workspace", "Workspace-ID"), P("data.assignee", "Toegewezen aan (ID of 'me')"), P("data.due_on", "Deadline (JJJJ-MM-DD)")] },
      { id: "task.get", resource: "Taak", label: "Taak ophalen", method: "GET", path: "/tasks/{{taskGid}}", output: "data", params: [path("taskGid", "Taak-ID")] },
      { id: "task.update", resource: "Taak", label: "Taak bijwerken", method: "PUT", path: "/tasks/{{taskGid}}", output: "data", params: [path("taskGid", "Taak-ID"), P("data.name", "Naam"), P("data.notes", "Notities", { type: "text" }), bool("data.completed", "Afgerond"), P("data.due_on", "Deadline")] },
      { id: "task.list", resource: "Taak", label: "Taken", method: "GET", path: "/tasks", output: "data", params: [q("project", "Project-ID"), q("assignee", "Toegewezen aan"), q("workspace", "Workspace-ID"), q("completed_since", "Open sinds (ISO / now)", { default: "now" }), q("opt_fields", "Velden", { default: "name,completed,due_on,assignee.name" })] },
      { id: "task.comment", resource: "Taak", label: "Reactie plaatsen", method: "POST", path: "/tasks/{{taskGid}}/stories", output: "data", params: [path("taskGid", "Taak-ID"), P("data.text", "Reactie", { type: "text", required: true })] },
      { id: "task.delete", resource: "Taak", label: "Taak verwijderen", method: "DELETE", path: "/tasks/{{taskGid}}", params: [path("taskGid", "Taak-ID")] },
      { id: "project.list", resource: "Project", label: "Projecten", method: "GET", path: "/projects", output: "data", params: [q("workspace", "Workspace-ID")] },
      { id: "workspace.list", resource: "Workspace", label: "Workspaces", method: "GET", path: "/workspaces", output: "data" },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me", output: "data" }
    ]
  },
  {
    id: "trello", name: "Trello", category: "Projectbeheer", description: "Borden, lijsten en kaarten", color: "#0079bf",
    website: "https://trello.com", docs: "https://developer.atlassian.com/cloud/trello/rest/",
    baseUrl: "https://api.trello.com/1", auth: { type: "query", query: { key: "{{apiKey}}", token: "{{token}}" }, fields: [{ key: "apiKey", label: "API-key" }, { key: "token", label: "Token", secret: true }] }, test: "board.list",
    operations: [
      { id: "card.create", resource: "Kaart", label: "Kaart maken", method: "POST", path: "/cards", params: [q("idList", "Lijst-ID", { required: true }), q("name", "Titel", { required: true }), q("desc", "Omschrijving"), q("due", "Deadline (ISO)"), q("idLabels", "Label-ID's (komma)"), q("pos", "Positie", { default: "bottom" })] },
      { id: "card.get", resource: "Kaart", label: "Kaart ophalen", method: "GET", path: "/cards/{{id}}", params: [path("id", "Kaart-ID")] },
      { id: "card.update", resource: "Kaart", label: "Kaart bijwerken / verplaatsen", method: "PUT", path: "/cards/{{id}}", params: [path("id", "Kaart-ID"), q("name", "Titel"), q("desc", "Omschrijving"), q("idList", "Naar lijst-ID"), q("closed", "Gearchiveerd")] },
      { id: "card.comment", resource: "Kaart", label: "Reactie plaatsen", method: "POST", path: "/cards/{{id}}/actions/comments", params: [path("id", "Kaart-ID"), q("text", "Reactie", { required: true })] },
      { id: "card.delete", resource: "Kaart", label: "Kaart verwijderen", method: "DELETE", path: "/cards/{{id}}", params: [path("id", "Kaart-ID")] },
      { id: "list.cards", resource: "Lijst", label: "Kaarten in lijst", method: "GET", path: "/lists/{{id}}/cards", params: [path("id", "Lijst-ID")] },
      { id: "board.lists", resource: "Bord", label: "Lijsten op bord", method: "GET", path: "/boards/{{id}}/lists", params: [path("id", "Bord-ID")] },
      { id: "board.list", resource: "Bord", label: "Mijn borden", method: "GET", path: "/members/me/boards", params: [q("fields", "Velden", { default: "name,url" })] }
    ]
  },
  {
    id: "clickup", name: "ClickUp", category: "Projectbeheer", description: "Taken, lijsten en tijdregistratie", color: "#7b68ee",
    website: "https://clickup.com", docs: "https://clickup.com/api",
    baseUrl: "https://api.clickup.com/api/v2", auth: { type: "apiKey", in: "header", name: "Authorization", label: "Personal API-token (pk_…)" }, test: "team.list",
    operations: [
      { id: "task.create", resource: "Taak", label: "Taak maken", method: "POST", path: "/list/{{listId}}/task", params: [path("listId", "Lijst-ID"), P("name", "Naam", { required: true }), P("description", "Omschrijving", { type: "text" }), P("status", "Status"), num("priority", "Prioriteit (1-4)"), num("due_date", "Deadline (ms sinds 1970)"), P("assignees", "Toegewezen (ID's)", { format: "list", type: "number" }), P("tags", "Tags", { format: "list" })] },
      { id: "task.get", resource: "Taak", label: "Taak ophalen", method: "GET", path: "/task/{{taskId}}", params: [path("taskId", "Taak-ID")] },
      { id: "task.update", resource: "Taak", label: "Taak bijwerken", method: "PUT", path: "/task/{{taskId}}", params: [path("taskId", "Taak-ID"), P("name", "Naam"), P("description", "Omschrijving", { type: "text" }), P("status", "Status"), num("priority", "Prioriteit")] },
      { id: "task.comment", resource: "Taak", label: "Reactie plaatsen", method: "POST", path: "/task/{{taskId}}/comment", params: [path("taskId", "Taak-ID"), P("comment_text", "Reactie", { type: "text", required: true })] },
      { id: "task.list", resource: "Taak", label: "Taken in lijst", method: "GET", path: "/list/{{listId}}/task", output: "tasks", params: [path("listId", "Lijst-ID"), q("archived", "Gearchiveerd", { default: "false" })] },
      { id: "task.delete", resource: "Taak", label: "Taak verwijderen", method: "DELETE", path: "/task/{{taskId}}", params: [path("taskId", "Taak-ID")] },
      { id: "space.list", resource: "Space", label: "Spaces", method: "GET", path: "/team/{{teamId}}/space", output: "spaces", params: [path("teamId", "Workspace-ID")] },
      { id: "team.list", resource: "Workspace", label: "Workspaces", method: "GET", path: "/team", output: "teams" }
    ]
  },
  {
    id: "todoist", name: "Todoist", category: "Productiviteit", description: "Taken en projecten", color: "#e44332",
    website: "https://todoist.com", docs: "https://developer.todoist.com/rest/v2/",
    baseUrl: "https://api.todoist.com/rest/v2", auth: { type: "bearer", label: "API-token" }, test: "project.list",
    operations: [
      { id: "task.create", resource: "Taak", label: "Taak maken", method: "POST", path: "/tasks", params: [P("content", "Taak", { required: true }), P("description", "Omschrijving", { type: "text" }), P("project_id", "Project-ID"), P("due_string", "Wanneer (tekst)", { placeholder: "morgen 9:00" }), num("priority", "Prioriteit (1-4)"), P("labels", "Labels", { format: "list" })] },
      { id: "task.list", resource: "Taak", label: "Open taken", method: "GET", path: "/tasks", params: [q("project_id", "Project-ID"), q("filter", "Filter", { placeholder: "today | overdue" })] },
      { id: "task.get", resource: "Taak", label: "Taak ophalen", method: "GET", path: "/tasks/{{id}}", params: [path("id", "Taak-ID")] },
      { id: "task.update", resource: "Taak", label: "Taak bijwerken", method: "POST", path: "/tasks/{{id}}", params: [path("id", "Taak-ID"), P("content", "Taak"), P("description", "Omschrijving"), P("due_string", "Wanneer")] },
      { id: "task.close", resource: "Taak", label: "Taak afronden", method: "POST", path: "/tasks/{{id}}/close", params: [path("id", "Taak-ID")] },
      { id: "task.delete", resource: "Taak", label: "Taak verwijderen", method: "DELETE", path: "/tasks/{{id}}", params: [path("id", "Taak-ID")] },
      { id: "project.list", resource: "Project", label: "Projecten", method: "GET", path: "/projects" }
    ]
  },
  {
    id: "monday", name: "monday.com", category: "Projectbeheer", description: "Borden, groepen en items (GraphQL-API)", color: "#ff3d57",
    website: "https://monday.com", docs: "https://developer.monday.com/api-reference",
    baseUrl: "https://api.monday.com/v2", auth: { type: "apiKey", in: "header", name: "Authorization", label: "API-token" }, headers: { "API-Version": "2024-10" }, graphqlErrors: true, test: "me",
    operations: [
      { id: "item.create", resource: "Item", label: "Item maken", method: "POST", path: "", output: "data.create_item",
        body: { query: "mutation ($board: ID!, $group: String, $name: String!, $values: JSON) { create_item (board_id: $board, group_id: $group, item_name: $name, column_values: $values) { id name } }", variables: { board: "{{boardId}}", group: "{{groupId}}", name: "{{name}}", values: "{{columnValues}}" } },
        params: [P("boardId", "Bord-ID", { required: true }), P("groupId", "Groep-ID"), P("name", "Naam", { required: true }), P("columnValues", "Kolomwaarden (JSON-tekst)", { placeholder: '{"status":{"label":"Klaar"},"date4":{"date":"2026-10-01"}}' })] },
      { id: "item.updateColumns", resource: "Item", label: "Kolommen bijwerken", method: "POST", path: "", output: "data.change_multiple_column_values",
        body: { query: "mutation ($board: ID!, $item: ID!, $values: JSON!) { change_multiple_column_values (board_id: $board, item_id: $item, column_values: $values) { id } }", variables: { board: "{{boardId}}", item: "{{itemId}}", values: "{{columnValues}}" } },
        params: [P("boardId", "Bord-ID", { required: true }), P("itemId", "Item-ID", { required: true }), P("columnValues", "Kolomwaarden (JSON-tekst)", { required: true })] },
      { id: "item.list", resource: "Item", label: "Items op bord", method: "POST", path: "", output: "data.boards.0.items_page.items",
        body: { query: "query ($board: [ID!], $limit: Int) { boards (ids: $board) { items_page (limit: $limit) { items { id name group { id title } column_values { id text } } } } }", variables: { board: "{{boardId}}", limit: "{{limit}}" } },
        params: [P("boardId", "Bord-ID", { required: true }), num("limit", "Aantal", { default: 50 })] },
      { id: "board.list", resource: "Bord", label: "Borden", method: "POST", path: "", output: "data.boards", body: { query: "query ($limit: Int) { boards (limit: $limit) { id name groups { id title } } }", variables: { limit: "{{limit}}" } }, params: [num("limit", "Aantal", { default: 25 })] },
      { id: "graphql", resource: "GraphQL", label: "Eigen GraphQL-query", method: "POST", path: "", params: [P("query", "Query", { type: "text", required: true }), json("variables", "Variabelen")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "POST", path: "", output: "data.me", body: { query: "{ me { id name email } }" } }
    ]
  },
  {
    id: "notion", name: "Notion", category: "Productiviteit", description: "Pagina's, databases en blokken", color: "#000000",
    website: "https://notion.so", docs: "https://developers.notion.com/reference",
    baseUrl: "https://api.notion.com/v1", auth: { type: "bearer", label: "Integratietoken (secret_…/ntn_…)", help: "Maak een interne integratie op notion.so/my-integrations en deel de pagina's/databases met die integratie." },
    headers: { "Notion-Version": "2022-06-28" }, test: "me",
    operations: [
      { id: "database.query", resource: "Database", label: "Database doorzoeken", method: "POST", path: "/databases/{{databaseId}}/query", output: "results", params: [path("databaseId", "Database-ID"), json("filter", "Filter", { placeholder: '{"property":"Status","status":{"equals":"Open"}}' }), json("sorts", "Sortering"), num("page_size", "Aantal", { default: 100 })] },
      { id: "page.create", resource: "Pagina", label: "Pagina in database maken", method: "POST", path: "/pages", body: { parent: { database_id: "{{databaseId}}" }, properties: "{{properties}}", children: "{{children}}" },
        params: [P("databaseId", "Database-ID", { required: true }), json("properties", "Eigenschappen", { required: true, placeholder: '{"Naam":{"title":[{"text":{"content":"{{orderId}}"}}]},"Status":{"status":{"name":"Open"}}}' }), json("children", "Inhoud (blokken)")] },
      { id: "page.get", resource: "Pagina", label: "Pagina ophalen", method: "GET", path: "/pages/{{pageId}}", params: [path("pageId", "Pagina-ID")] },
      { id: "page.update", resource: "Pagina", label: "Pagina bijwerken", method: "PATCH", path: "/pages/{{pageId}}", params: [path("pageId", "Pagina-ID"), json("properties", "Eigenschappen"), bool("archived", "Archiveren")] },
      { id: "block.append", resource: "Blok", label: "Tekst toevoegen aan pagina", method: "PATCH", path: "/blocks/{{blockId}}/children", body: { children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "{{text}}" } }] } }] },
        params: [path("blockId", "Pagina-/blok-ID"), P("text", "Tekst", { type: "text", required: true })] },
      { id: "block.children", resource: "Blok", label: "Inhoud van pagina", method: "GET", path: "/blocks/{{blockId}}/children", output: "results", params: [path("blockId", "Pagina-/blok-ID")] },
      { id: "search", resource: "Zoeken", label: "Zoeken", method: "POST", path: "/search", output: "results", params: [P("query", "Zoektekst"), json("filter", "Filter", { placeholder: '{"property":"object","value":"database"}' })] },
      { id: "me", resource: "Account", label: "Integratie-account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "airtable", name: "Airtable", category: "Data & opslag", description: "Records in Airtable-bases", color: "#18bfff",
    website: "https://airtable.com", docs: "https://airtable.com/developers/web/api/introduction",
    baseUrl: "https://api.airtable.com/v0", auth: { type: "bearer", label: "Personal access token" }, test: "whoami",
    operations: [
      { id: "record.list", resource: "Record", label: "Records", method: "GET", path: "/{{baseId}}/{{table}}", output: "records", params: [path("baseId", "Base-ID (app…)"), path("table", "Tabel (naam of ID)"), q("filterByFormula", "Filter (formule)", { placeholder: "{Status}='Open'" }), q("maxRecords", "Max. records", { default: "100" }), q("view", "View")] },
      { id: "record.get", resource: "Record", label: "Record ophalen", method: "GET", path: "/{{baseId}}/{{table}}/{{recordId}}", params: [path("baseId", "Base-ID"), path("table", "Tabel"), path("recordId", "Record-ID")] },
      { id: "record.create", resource: "Record", label: "Record maken", method: "POST", path: "/{{baseId}}/{{table}}", params: [path("baseId", "Base-ID"), path("table", "Tabel"), json("fields", "Velden", { required: true, placeholder: '{"Naam":"{{klant}}","Bedrag":{{bedrag}}}' }), bool("typecast", "Waarden omzetten", { default: true })] },
      { id: "record.upsert", resource: "Record", label: "Records bijwerken of maken (upsert)", method: "PATCH", path: "/{{baseId}}/{{table}}", body: { performUpsert: { fieldsToMergeOn: "{{mergeOn}}" }, records: [{ fields: "{{fields}}" }], typecast: true },
        params: [path("baseId", "Base-ID"), path("table", "Tabel"), P("mergeOn", "Sleutelvelden", { format: "list", required: true }), json("fields", "Velden", { required: true })] },
      { id: "record.update", resource: "Record", label: "Record bijwerken", method: "PATCH", path: "/{{baseId}}/{{table}}/{{recordId}}", params: [path("baseId", "Base-ID"), path("table", "Tabel"), path("recordId", "Record-ID"), json("fields", "Velden", { required: true })] },
      { id: "record.delete", resource: "Record", label: "Record verwijderen", method: "DELETE", path: "/{{baseId}}/{{table}}/{{recordId}}", params: [path("baseId", "Base-ID"), path("table", "Tabel"), path("recordId", "Record-ID")] },
      { id: "base.list", resource: "Base", label: "Bases", method: "GET", path: "/meta/bases", output: "bases" },
      { id: "whoami", resource: "Account", label: "Mijn account", method: "GET", path: "/meta/whoami" }
    ]
  },
  {
    id: "taiga", name: "Taiga", category: "Projectbeheer", description: "Issues en user stories", color: "#83eede",
    website: "https://taiga.io", docs: "https://docs.taiga.io/api.html",
    baseUrl: "{{url}}/api/v1", auth: { type: "bearer", label: "Auth-token" }, fields: [urlField("Taiga-URL", "https://api.taiga.io")], test: "me",
    operations: [
      { id: "issue.create", resource: "Issue", label: "Issue maken", method: "POST", path: "/issues", params: [num("project", "Project-ID", { required: true }), P("subject", "Onderwerp", { required: true }), P("description", "Omschrijving", { type: "text" })] },
      { id: "issue.list", resource: "Issue", label: "Issues", method: "GET", path: "/issues", params: [q("project", "Project-ID")] },
      { id: "userstory.create", resource: "User story", label: "User story maken", method: "POST", path: "/userstories", params: [num("project", "Project-ID", { required: true }), P("subject", "Onderwerp", { required: true }), P("description", "Omschrijving", { type: "text" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "circleci", name: "CircleCI", category: "Ontwikkeling", description: "Pipelines starten en volgen", color: "#343434",
    website: "https://circleci.com", docs: "https://circleci.com/docs/api/v2/",
    baseUrl: "https://circleci.com/api/v2", auth: { type: "apiKey", in: "header", name: "Circle-Token", label: "Personal API-token" }, test: "me",
    operations: [
      { id: "pipeline.trigger", resource: "Pipeline", label: "Pipeline starten", method: "POST", path: "/project/{{projectSlug}}/pipeline", params: [path("projectSlug", "Project-slug", { format: "raw", placeholder: "gh/org/repo" }), P("branch", "Branch", { default: "main" }), json("parameters", "Parameters")] },
      { id: "pipeline.list", resource: "Pipeline", label: "Pipelines", method: "GET", path: "/project/{{projectSlug}}/pipeline", output: "items", params: [path("projectSlug", "Project-slug", { format: "raw" }), q("branch", "Branch")] },
      { id: "workflow.list", resource: "Workflow", label: "Workflows van pipeline", method: "GET", path: "/pipeline/{{pipelineId}}/workflow", output: "items", params: [path("pipelineId", "Pipeline-ID")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me" }
    ]
  },
  {
    id: "jenkins", name: "Jenkins", category: "Ontwikkeling", description: "Jobs starten en builds bekijken", color: "#d33833",
    website: "https://jenkins.io", docs: "https://www.jenkins.io/doc/book/using/remote-access-api/",
    baseUrl: "{{url}}", auth: { type: "basic", userLabel: "Gebruiker", passLabel: "API-token" }, fields: [urlField("Jenkins-URL")], test: "info",
    operations: [
      { id: "job.build", resource: "Job", label: "Build starten", method: "POST", path: "/job/{{job}}/build", params: [path("job", "Job")] },
      { id: "job.buildWithParameters", resource: "Job", label: "Build met parameters", method: "POST", path: "/job/{{job}}/buildWithParameters", params: [path("job", "Job"), P("parameters", "Parameters (a=1&b=2)", { in: "rawQuery" })] },
      { id: "job.get", resource: "Job", label: "Job-info", method: "GET", path: "/job/{{job}}/api/json", params: [path("job", "Job")] },
      { id: "build.get", resource: "Build", label: "Laatste build", method: "GET", path: "/job/{{job}}/lastBuild/api/json", params: [path("job", "Job")] },
      { id: "info", resource: "Server", label: "Serverinfo", method: "GET", path: "/api/json" }
    ]
  },
  {
    id: "sentry-io", name: "Sentry.io", category: "Ontwikkeling", description: "Issues, events en releases", color: "#362d59",
    website: "https://sentry.io", docs: "https://docs.sentry.io/api/",
    baseUrl: "https://{{host}}/api/0", auth: { type: "bearer", label: "Auth-token" }, fields: [{ key: "host", label: "Host", default: "sentry.io", placeholder: "sentry.io of de.sentry.io" }], test: "org.list",
    operations: [
      { id: "issue.list", resource: "Issue", label: "Issues van project", method: "GET", path: "/projects/{{org}}/{{project}}/issues/", params: [path("org", "Organisatie"), path("project", "Project"), q("query", "Zoekvraag", { default: "is:unresolved" })] },
      { id: "issue.update", resource: "Issue", label: "Issue bijwerken", method: "PUT", path: "/issues/{{issueId}}/", params: [path("issueId", "Issue-ID"), P("status", "Status", { options: ["resolved", "unresolved", "ignored"] }), P("assignedTo", "Toegewezen aan")] },
      { id: "release.create", resource: "Release", label: "Release maken", method: "POST", path: "/organizations/{{org}}/releases/", params: [path("org", "Organisatie"), P("version", "Versie", { required: true }), P("projects", "Projecten", { format: "list", required: true })] },
      { id: "org.list", resource: "Organisatie", label: "Organisaties", method: "GET", path: "/organizations/" }
    ]
  },
  {
    id: "netlify", name: "Netlify", category: "Cloud & infra", description: "Sites, deploys en builds", color: "#00c7b7",
    website: "https://netlify.com", docs: "https://open-api.netlify.com",
    baseUrl: "https://api.netlify.com/api/v1", auth: { type: "bearer", label: "Personal access token" }, test: "site.list",
    operations: [
      { id: "site.list", resource: "Site", label: "Sites", method: "GET", path: "/sites" },
      { id: "deploy.list", resource: "Deploy", label: "Deploys", method: "GET", path: "/sites/{{siteId}}/deploys", params: [path("siteId", "Site-ID")] },
      { id: "build.trigger", resource: "Build", label: "Nieuwe build starten", method: "POST", path: "/sites/{{siteId}}/builds", params: [path("siteId", "Site-ID"), bool("clear_cache", "Cache legen", { default: false })] }
    ]
  },
  {
    id: "cloudflare", name: "Cloudflare", category: "Cloud & infra", description: "Zones, DNS en cache", color: "#f38020",
    website: "https://cloudflare.com", docs: "https://developers.cloudflare.com/api/",
    baseUrl: "https://api.cloudflare.com/client/v4", auth: { type: "bearer", label: "API-token" }, okField: "success", errorPath: "errors.0.message", test: "verify",
    operations: [
      { id: "zone.list", resource: "Zone", label: "Zones", method: "GET", path: "/zones", output: "result", params: [q("name", "Domein")] },
      { id: "dns.list", resource: "DNS", label: "DNS-records", method: "GET", path: "/zones/{{zoneId}}/dns_records", output: "result", params: [path("zoneId", "Zone-ID"), q("name", "Naam"), q("type", "Type")] },
      { id: "dns.create", resource: "DNS", label: "DNS-record maken", method: "POST", path: "/zones/{{zoneId}}/dns_records", output: "result", params: [path("zoneId", "Zone-ID"), P("type", "Type", { default: "A", options: ["A", "AAAA", "CNAME", "TXT", "MX"] }), P("name", "Naam", { required: true }), P("content", "Waarde", { required: true }), num("ttl", "TTL (1 = auto)", { default: 1 }), bool("proxied", "Via Cloudflare", { default: false })] },
      { id: "dns.delete", resource: "DNS", label: "DNS-record verwijderen", method: "DELETE", path: "/zones/{{zoneId}}/dns_records/{{recordId}}", params: [path("zoneId", "Zone-ID"), path("recordId", "Record-ID")] },
      { id: "cache.purge", resource: "Cache", label: "Cache legen", method: "POST", path: "/zones/{{zoneId}}/purge_cache", params: [path("zoneId", "Zone-ID"), bool("purge_everything", "Alles", { default: false }), P("files", "URL's", { format: "list" })] },
      { id: "verify", resource: "Account", label: "Token controleren", method: "GET", path: "/user/tokens/verify", output: "result" }
    ]
  },
  {
    id: "uptimerobot", name: "UptimeRobot", category: "Cloud & infra", description: "Monitors en statuspagina's", color: "#3bd671",
    website: "https://uptimerobot.com", docs: "https://uptimerobot.com/api/",
    baseUrl: "https://api.uptimerobot.com/v2", auth: { type: "headers", headers: {}, fields: [{ key: "apiKey", label: "API-key", secret: true }] }, errorPath: "error.message", test: "account",
    operations: [
      { id: "monitor.list", resource: "Monitor", label: "Monitors", method: "POST", path: "/getMonitors", bodyType: "form", output: "monitors", body: { api_key: "{{apiKey}}", format: "json" } },
      { id: "monitor.create", resource: "Monitor", label: "Monitor maken", method: "POST", path: "/newMonitor", bodyType: "form", body: { api_key: "{{apiKey}}", format: "json", type: "1", friendly_name: "{{name}}", url: "{{url}}" }, params: [P("name", "Naam", { required: true }), P("url", "URL", { required: true })] },
      { id: "account", resource: "Account", label: "Account", method: "POST", path: "/getAccountDetails", bodyType: "form", body: { api_key: "{{apiKey}}", format: "json" } }
    ]
  },
  {
    id: "pagerduty", name: "PagerDuty", category: "Cloud & infra", description: "Incidenten en diensten", color: "#06ac38",
    website: "https://pagerduty.com", docs: "https://developer.pagerduty.com/api-reference/",
    baseUrl: "https://api.pagerduty.com", auth: { type: "headers", headers: { Authorization: "Token token={{apiKey}}" }, fields: [{ key: "apiKey", label: "API-key", secret: true }] }, headers: { Accept: "application/vnd.pagerduty+json;version=2" }, test: "service.list",
    operations: [
      { id: "incident.create", resource: "Incident", label: "Incident maken", method: "POST", path: "/incidents", body: { incident: { type: "incident", title: "{{title}}", service: { id: "{{serviceId}}", type: "service_reference" }, urgency: "{{urgency}}", body: { type: "incident_body", details: "{{details}}" } } },
        params: [P("From", "Van (e-mail PagerDuty-gebruiker)", { in: "header", required: true }), P("title", "Titel", { required: true }), P("serviceId", "Dienst-ID", { required: true }), P("urgency", "Urgentie", { default: "high", options: ["high", "low"] }), P("details", "Details", { type: "text" })] },
      { id: "incident.list", resource: "Incident", label: "Incidenten", method: "GET", path: "/incidents", output: "incidents", params: [q("statuses[]", "Status", { placeholder: "triggered" })] },
      { id: "incident.resolve", resource: "Incident", label: "Incident oplossen", method: "PUT", path: "/incidents/{{id}}", body: { incident: { type: "incident_reference", status: "resolved" } }, params: [P("From", "Van (e-mail)", { in: "header", required: true }), path("id", "Incident-ID")] },
      { id: "service.list", resource: "Dienst", label: "Diensten", method: "GET", path: "/services", output: "services" }
    ]
  },
  {
    id: "grafana", name: "Grafana", category: "Analyse", description: "Dashboards, annotaties en teams", color: "#f46800",
    website: "https://grafana.com", docs: "https://grafana.com/docs/grafana/latest/developers/http_api/",
    baseUrl: "{{url}}/api", auth: { type: "bearer", label: "Service-account token" }, fields: [urlField("Grafana-URL")], test: "org",
    operations: [
      { id: "dashboard.search", resource: "Dashboard", label: "Dashboards zoeken", method: "GET", path: "/search", params: [q("query", "Zoektekst"), q("type", "Type", { default: "dash-db" })] },
      { id: "dashboard.get", resource: "Dashboard", label: "Dashboard ophalen", method: "GET", path: "/dashboards/uid/{{uid}}", params: [path("uid", "Dashboard-UID")] },
      { id: "annotation.create", resource: "Annotatie", label: "Annotatie plaatsen", method: "POST", path: "/annotations", params: [P("text", "Tekst", { required: true }), P("tags", "Tags", { format: "list" }), P("dashboardUID", "Dashboard-UID"), num("time", "Tijd (ms)")] },
      { id: "team.list", resource: "Team", label: "Teams", method: "GET", path: "/teams/search", output: "teams" },
      { id: "org", resource: "Organisatie", label: "Organisatie", method: "GET", path: "/org" }
    ]
  },
  {
    id: "metabase", name: "Metabase", category: "Analyse", description: "Vragen, dashboards en databronnen", color: "#509ee3",
    website: "https://metabase.com", docs: "https://www.metabase.com/docs/latest/api-documentation",
    baseUrl: "{{url}}/api", auth: { type: "apiKey", in: "header", name: "x-api-key", label: "API-key" }, fields: [urlField("Metabase-URL")], test: "me",
    operations: [
      { id: "card.list", resource: "Vraag", label: "Vragen", method: "GET", path: "/card" },
      { id: "card.query", resource: "Vraag", label: "Vraag uitvoeren", method: "POST", path: "/card/{{id}}/query", output: "data", params: [path("id", "Vraag-ID")] },
      { id: "database.list", resource: "Database", label: "Databronnen", method: "GET", path: "/database", output: "data" },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/user/current" }
    ]
  },
  {
    id: "posthog", name: "PostHog", category: "Analyse", description: "Events vastleggen", color: "#f54e00",
    website: "https://posthog.com", docs: "https://posthog.com/docs/api/capture",
    baseUrl: "{{url}}", auth: { type: "headers", headers: {}, fields: [{ key: "projectKey", label: "Project API-key", secret: true }, { key: "url", label: "Host (URL)", default: "https://eu.i.posthog.com" }] },
    operations: [
      { id: "event.capture", resource: "Event", label: "Event vastleggen", method: "POST", path: "/capture/", body: { api_key: "{{projectKey}}", event: "{{event}}", distinct_id: "{{distinctId}}", properties: "{{properties}}" }, params: [P("event", "Event", { required: true }), P("distinctId", "Gebruiker (distinct_id)", { required: true }), json("properties", "Eigenschappen")] },
      { id: "person.identify", resource: "Persoon", label: "Persoon identificeren", method: "POST", path: "/capture/", body: { api_key: "{{projectKey}}", event: "$identify", distinct_id: "{{distinctId}}", properties: { $set: "{{set}}" } }, params: [P("distinctId", "Gebruiker", { required: true }), json("set", "Eigenschappen", { required: true })] }
    ]
  },
  {
    id: "segment", name: "Segment", category: "Analyse", description: "Track, identify en group", color: "#52bd94",
    website: "https://segment.com", docs: "https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/",
    baseUrl: "https://api.segment.io/v1", auth: { type: "basic", userLabel: "Write key", passLabel: "(leeg laten)" },
    operations: [
      { id: "track", resource: "Event", label: "Event (track)", method: "POST", path: "/track", params: [P("userId", "Gebruiker-ID"), P("anonymousId", "Anoniem ID"), P("event", "Event", { required: true }), json("properties", "Eigenschappen")] },
      { id: "identify", resource: "Gebruiker", label: "Identify", method: "POST", path: "/identify", params: [P("userId", "Gebruiker-ID", { required: true }), json("traits", "Kenmerken")] },
      { id: "group", resource: "Groep", label: "Group", method: "POST", path: "/group", params: [P("userId", "Gebruiker-ID", { required: true }), P("groupId", "Groep-ID", { required: true }), json("traits", "Kenmerken")] }
    ]
  },
  {
    id: "quickchart", name: "QuickChart", category: "Analyse", description: "Grafieken als afbeelding", color: "#3b82f6",
    website: "https://quickchart.io", docs: "https://quickchart.io/documentation/",
    baseUrl: "https://quickchart.io", auth: { type: "none" },
    operations: [{ id: "chart.create", resource: "Grafiek", label: "Grafiek-URL maken", method: "POST", path: "/chart/create", params: [json("chart", "Chart.js-config", { required: true, placeholder: '{"type":"bar","data":{"labels":["a","b"],"datasets":[{"label":"Omzet","data":[1,2]}]}}' }), num("width", "Breedte", { default: 600 }), num("height", "Hoogte", { default: 300 }), P("backgroundColor", "Achtergrond", { default: "white" })] }]
  },
  {
    id: "home-assistant", name: "Home Assistant", category: "Overig", description: "Apparaten en services in huis", color: "#18bcf2",
    website: "https://home-assistant.io", docs: "https://developers.home-assistant.io/docs/api/rest/",
    baseUrl: "{{url}}/api", auth: { type: "bearer", label: "Long-lived access token" }, fields: [urlField("Home Assistant-URL", "http://homeassistant.local:8123")], test: "config",
    operations: [
      { id: "state.get", resource: "Status", label: "Status van entiteit", method: "GET", path: "/states/{{entityId}}", params: [path("entityId", "Entiteit", { placeholder: "light.woonkamer" })] },
      { id: "state.list", resource: "Status", label: "Alle statussen", method: "GET", path: "/states" },
      { id: "service.call", resource: "Service", label: "Service aanroepen", method: "POST", path: "/services/{{domain}}/{{service}}", bodyParam: "data", params: [path("domain", "Domein", { placeholder: "light" }), path("service", "Service", { placeholder: "turn_on" }), json("data", "Data", { default: {}, placeholder: '{"entity_id":"light.woonkamer"}' })] },
      { id: "event.fire", resource: "Event", label: "Event afvuren", method: "POST", path: "/events/{{eventType}}", bodyParam: "data", params: [path("eventType", "Eventtype"), json("data", "Data", { default: {} })] },
      { id: "config", resource: "Server", label: "Configuratie", method: "GET", path: "/config" }
    ]
  },
  {
    id: "graphql", name: "GraphQL", category: "Ontwikkeling", description: "Willekeurige GraphQL-API aanroepen", color: "#e10098",
    website: "https://graphql.org", docs: "https://graphql.org/learn/serving-over-http/",
    baseUrl: "{{endpoint}}", auth: { type: "headers", headers: { Authorization: "{{authorization}}" }, fields: [{ key: "endpoint", label: "Endpoint", placeholder: "https://api.voorbeeld.nl/graphql" }, { key: "authorization", label: "Authorization-header (optioneel)", secret: true, placeholder: "Bearer …" }] },
    graphqlErrors: true,
    operations: [{ id: "query", resource: "Query", label: "Query of mutation", method: "POST", path: "", params: [P("query", "Query", { type: "text", required: true }), json("variables", "Variabelen"), P("operationName", "Operatienaam")] }]
  },
  {
    id: "npm", name: "npm", category: "Ontwikkeling", description: "Pakketten en versies in de npm-registry", color: "#cb3837",
    website: "https://npmjs.com", docs: "https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md",
    baseUrl: "https://registry.npmjs.org", auth: { type: "none" }, test: "search",
    operations: [
      { id: "package.get", resource: "Pakket", label: "Pakketinfo", method: "GET", path: "/{{name}}", params: [path("name", "Pakket", { format: "raw", placeholder: "fastify of @scope/naam" })] },
      { id: "package.latest", resource: "Pakket", label: "Laatste versie", method: "GET", path: "/{{name}}/latest", params: [path("name", "Pakket", { format: "raw" })] },
      { id: "search", resource: "Zoeken", label: "Zoeken", method: "GET", path: "/-/v1/search", output: "objects", params: [q("text", "Zoektekst", { default: "integration" }), q("size", "Aantal", { default: "20" })] }
    ]
  }
];
