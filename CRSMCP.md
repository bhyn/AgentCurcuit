skip to:contentpackage searchsign in

Pro
Teams
Pricing
Documentation
npm
Search packages
Search
@crscreditapi/crs-calhacks-mcp-server
TypeScript icon, indicating that this package has built-in type declarations
1.1.2 • Public • Published a day ago
CRS CalHacks MCP Server
Hackathon use only. This server is built for CalHacks teams and talks only to the CRS sandbox. Every person, business, and record in the sandbox is fake. Do not use it with real consumer data or production credentials.

The CRS CalHacks MCP server gives your AI coding assistant (Claude Code, Claude Desktop, Cursor, VS Code) the CRS Credit API docs, request schemas, 20 sandbox test personas, and the OpenAPI spec, plus a tool that looks up what the sandbox returned for any request you made. You still write and run the integration code yourself; the MCP server makes your assistant good at writing it.

┌──────────────────┐ MCP (stdio) ┌──────────────────────────┐ HTTPS ┌──────────────────────┐
│ Your AI assistant│ ◄───────────► │ crs-calhacks-mcp-server │ ◄─────► │ CRS sandbox API │
│ (Claude, Cursor) │ │ (runs on your machine) │ │ api-sandbox. │
└──────────────────┘ └──────────────────────────┘ │ stitchcredit.com/api │
└──────────────────────┘

1. What you need
   Node.js 18 or newer — check with node --version
   CRS sandbox credentials — a username and password from the CRS team at CalHacks
   An MCP client: Claude Code, Claude Desktop, Cursor, or VS Code
2. Connect it
   You don't install anything by hand. Your MCP client starts the server itself: the config below tells it to run npx -y @crscreditapi/crs-calhacks-mcp-server@latest, which downloads the package from npm the first time, runs it over stdio, and picks up new versions (@latest). Pick your client and replace YOUR_USERNAME / YOUR_PASSWORD with your sandbox credentials.

Prefer a fixed install? npm install -g @crscreditapi/crs-calhacks-mcp-server, then use "command": "crs-calhacks-mcp-server" with no args in the configs below.

Claude Code
One command, from your project folder:

claude mcp add crs-calhacks \
 -e CRS_USERNAME=YOUR_USERNAME \
 -e CRS_PASSWORD=YOUR_PASSWORD \
 -- npx -y @crscreditapi/crs-calhacks-mcp-server@latest
Or add a .mcp.json file to your project root. Claude Code picks it up when you start it in that folder, and asks you once to approve the server:

{
"mcpServers": {
"crs-calhacks": {
"command": "npx",
"args": ["-y", "@crscreditapi/crs-calhacks-mcp-server@latest"],
"env": {
"CRS_USERNAME": "YOUR_USERNAME",
"CRS_PASSWORD": "YOUR_PASSWORD"
}
}
}
}
.mcp.json holds your password, so keep it out of git:

echo ".mcp.json" >> .gitignore
Restart Claude Code, then run /mcp to confirm crs-calhacks shows as connected.

Already have a .mcp.json? Add the crs-calhacks entry inside the existing mcpServers object instead of replacing the file.

Claude Desktop
Open Settings → Developer → Edit Config. This opens claude_desktop_config.json:

macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
Windows: %APPDATA%\Claude\claude_desktop_config.json
Add the server (keep any servers already there):

{
"mcpServers": {
"crs-calhacks": {
"command": "npx",
"args": ["-y", "@crscreditapi/crs-calhacks-mcp-server@latest"],
"env": {
"CRS_USERNAME": "YOUR_USERNAME",
"CRS_PASSWORD": "YOUR_PASSWORD"
}
}
}
}
Quit and reopen Claude Desktop. The server's tools appear under the tools (slider) icon in the chat box.

Cursor
Create .cursor/mcp.json in your project (or ~/.cursor/mcp.json for all projects) with the same mcpServers block as above, then enable it in Settings → MCP.

VS Code (GitHub Copilot agent mode)
Create .vscode/mcp.json:

{
"servers": {
"crs-calhacks": {
"type": "stdio",
"command": "npx",
"args": ["-y", "@crscreditapi/crs-calhacks-mcp-server@latest"],
"env": {
"CRS_USERNAME": "YOUR_USERNAME",
"CRS_PASSWORD": "YOUR_PASSWORD"
}
}
}
} 3. Check it works
Ask your assistant:

What CRS products can I use, and how do I authenticate?

It should call get_auth_info and list the products below. If it doesn't, see Troubleshooting.

4. Products
   Product key Product Main endpoints
   credit_report Credit report, CRS Standard Format (TransUnion FICO 9, Equifax and Experian VantageScore 4.0 prequalification) POST /transunion/credit-report/standard/tu-prequal-fico9 · /equifax/.../efx-prequal-vantage4 · /experian/.../exp-prequal-vantage4 · re-read · PDF
   criminal CIC criminal background check POST /criminal/new-request · GET /criminal/get-response/{id} · PDF
   eviction CIC eviction records POST /eviction/new-request · GET /eviction/get-response/{id} · PDF
   accurate_append AccurateAppend: reverse lookup, mobile / landline / email append, batch CSV append POST /accurate-append/reverse · /accurate-append/phone/single-best-match/mobile · .../landline · /accurate-append/email · batch: /accurate-append/s3/presigned-upload → /jobs
   fraud_finder AtData Fraud Finder (email, phone, IP, address) POST /fraud-finder/fraud-finder · PDF
   tu_identity_verification TransUnion TruValidate identity verification POST /transunion/identity-manager-verification/basic
   pitchpoint_blj PitchPoint bankruptcies, liens & judgments (FCRA civil court search) POST /pp/fcrablj/data · POST /pp/fcrablj · PDF
   Your sandbox account must have each product turned on; a 401 from a product means it isn't. All endpoints live under https://api-sandbox.stitchcredit.com/api. Ask your assistant for get_product_guide on any product key to get the full walkthrough.

5. Tools and resources
   Tools
   Tool What it returns Try asking
   get_auth_info How to log in and send the token "How do I authenticate with the CRS API?"
   get_product_guide Step-by-step guide for one product: flow, curl example, response fields, sandbox configs, gotchas "How do I tell whether TransUnion verified the identity?"
   get_api_schema Request fields, validation, endpoints, and an example request for one product "What fields does the Experian credit report need?"
   get_test_data Exact request bodies of the sandbox personas for one product, with the expected result of each "Give me the felony persona's criminal search request."
   get_personas The 20 sandbox personas (prime, subprime, bankruptcy, felony, eviction, fraud, deceased …) with expected decisions; pass an id for all of one person's requests "Which persona should my app decline, and what do I send for them?"
   get_openapi_spec The OpenAPI 3 spec for the CalHacks routes; pass pathFilter (e.g. /accurate-append) for a complete spec of just those routes "Show me the OpenAPI spec for /accurate-append."
   get_use_cases Hackathon project ideas that combine the products "What could I build with eviction and credit data?"
   debug_request What the sandbox stored for a request: your payload and the raw vendor response "Debug request 3f2a… — why did my criminal check come back empty?"
   Resources
   Clients that support MCP resources can attach these directly:

crs://docs/quickstart, crs://docs/products, crs://docs/use-cases
crs://guides/{product} — the product guide
crs://schemas/{product} — the request schema
crs://test-data/{product} — sandbox test inputs
crs://test-data/personas — all 20 personas with every request 6. Calling the API from your app
The MCP server helps your assistant write code; your app calls the API directly.

Log in once and keep the token:

curl -X POST https://api-sandbox.stitchcredit.com/api/users/login \
 -H "Content-Type: application/json" \
 -d '{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}'
The response contains a token. Send it on every call as Authorization: Bearer <token>. When you get a 401, log in again (or use POST /users/refresh-token, but not right after login: that returns CRS117).

Log in once and reuse the token. Repeated failed logins disable the account with no warning. If your password is in a .env file, quote it: an unquoted # starts a comment.

Call a product endpoint with Content-Type: application/json. Credit reports and Fraud Finder take a {config} path segment (the configs are in the table above); the others use your account's default.

Credit reports return errors as HTTP 200. Check errorMessages in the body before anything else. Re-reading a report or getting its PDF needs the original order's body, too.

Test with the sandbox personas. The sandbox answers with canned results for 20 fake applicants. Send a persona's request body as given (extra fields are fine, missing ones are not); anything that doesn't match a persona goes to the real vendor.

Save the RequestID response header. It identifies the request in the sandbox. Pass it to debug_request (or GET /users/retention/{id}) to see exactly what was sent and what the vendor returned. Right after a call, retention can briefly answer 500 "S3 key does not exist": retry 5xx with backoff (0.5 s, 1 s, 2 s, 4 s). debug_request already does.

Keep credentials out of the browser. Call the CRS API from your backend, not from frontend JavaScript, and keep CRS_USERNAME / CRS_PASSWORD in environment variables.

7. Troubleshooting
   Symptom Fix
   Server doesn't appear in the client Restart the client after editing the config. Check the JSON is valid (no trailing commas).
   Server fails to start Run npx -y @crscreditapi/crs-calhacks-mcp-server@latest in a terminal to see the error. Check node --version is 18+. On Windows, use "command": "cmd", "args": ["/c", "npx", "-y", "@crscreditapi/crs-calhacks-mcp-server@latest"].
   debug_request says CRS_USERNAME and CRS_PASSWORD environment variables must be set Add both to the env block of the server config. Only debug_request needs them; the docs tools work without credentials.
   Login failed (401) Wrong sandbox username or password. The MCP server stops trying after one failure (repeated failures disable the account): fix the credentials and restart your client.
   CRS113 / CRS114 on login Too many failed logins disabled the account. Ask the CRS team to re-enable it.
   Credit report returns 200 with E1005 User configuration not found Wrong config name, or your account doesn't have that bureau. Use the configs above or the ones the CRS team gave you.
   GET /users/retention/{id} returns 500 "S3 key does not exist" The record isn't stored yet. Retry after a moment, with backoff. PitchPoint PDF pulls are never stored in retention.
   403 Forbidden from an endpoint Your sandbox account isn't enabled for that product, or the request ID belongs to another user. Ask the CRS team.
   Empty, "no hit" or unexpected results The sandbox only returns canned data for its personas, and only when your body contains all of the persona's fields. Compare your request with get_test_data for that product.
   Need help? Find the CRS team at CalHacks.

Readme
Keywords
mcpcreditapicrsclaudehackathoncalhacks
Package Sidebar
Install
npm i @crscreditapi/crs-calhacks-mcp-server

Weekly Downloads
362

Version
1.1.2

License
MIT

Last publish
a day ago

Collaborators
tarikneradin
crs-mcp
Analyze security with SocketCheck bundle sizeView package healthExplore dependencies
Report malware
Footer
Support
Help
Advisories
Status
Contact npm
Company
About
Blog
Press
Terms & Policies
Policies
Terms of Use
Code of Conduct
Privacy
Viewing @crscreditapi/crs-calhacks-mcp-server version 1.1.2
