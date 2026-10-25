export const apiSnippets = {
  textCurl: `curl https://api.example.com/v1/moderation/text \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Example user-generated content","scene_id":"default","metadata":{"source":"playground"}}'`,
  textNode: `const response = await fetch("https://api.example.com/v1/moderation/text", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    text: "Example user-generated content",
    scene_id: "default",
    metadata: { source: "playground" }
  })
});

const result = await response.json();
if (result.status === "error") {
  throw new Error(result.error_message);
}
console.log(result.decision);`,
  imageCurl: `curl https://api.example.com/v1/moderation/image \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"image_url":"https://example.com/demo-image.png","scene_id":"default","metadata":{"source":"docs"}}'`,
};

export const errorCatalog = [400, 401, 403, 413, 429, 500, 503] as const;
