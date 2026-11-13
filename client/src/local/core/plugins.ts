export interface PluginDef {
  slug: string;
  name: string;
  category: string;
  blurb: string;
  context?: string[]; // read-only tools run first (e.g. get my profile / pages)
  steps: string[]; // tools that publish (text/link)
  stepsWithImage?: string[]; // preferred when a public poster URL exists
  target?: { label: string; placeholder: string; required?: boolean };
  hint: string;
  needsPublicMedia?: boolean;
}

export const PLUGINS: PluginDef[] = [
  { slug: "twitter", name: "X (Twitter)", category: "Social", blurb: "Post ads as tweets with your tracked link.", steps: ["TWITTER_CREATION_OF_A_POST"], hint: "Use `text` only (max 280 chars, keep the link). X API is pay-per-use: about $0.015 per post, $0.20 if it contains a URL." },
  { slug: "linkedin", name: "LinkedIn", category: "Social", blurb: "Share to your LinkedIn feed.", context: ["LINKEDIN_GET_MY_INFO"], steps: ["LINKEDIN_CREATE_LINKED_IN_POST"], hint: "author must be urn:li:person:<id> from the context result (field like sub/id/author_id). visibility PUBLIC, lifecycleState PUBLISHED. Put the caption in commentary. Set contentLandingPage to the link." },
  { slug: "facebook", name: "Facebook Pages", category: "Social", blurb: "Publish to a Page you manage.", context: ["FACEBOOK_GET_USER_PAGES"], steps: ["FACEBOOK_CREATE_POST"], stepsWithImage: ["FACEBOOK_CREATE_PHOTO_POST"], target: { label: "Page name or ID (optional)", placeholder: "Leave empty for your first Page" }, hint: "page_id comes from the context result; pick the page matching target if given, else the first one. Use message for the caption; for link posts set link. For photo posts set url to the poster URL." },
  { slug: "instagram", name: "Instagram", category: "Social", blurb: "Publish poster posts to a Business account.", context: ["INSTAGRAM_GET_USER_INFO"], steps: [], stepsWithImage: ["INSTAGRAM_CREATE_MEDIA_CONTAINER", "INSTAGRAM_CREATE_POST"], needsPublicMedia: true, hint: "Step 1 creates a media container with image_url = poster URL and caption; step 2 publishes it with creation_id = the id returned by step 1. ig_user_id from the context result." },
  { slug: "reddit", name: "Reddit", category: "Community", blurb: "Submit link posts to a subreddit.", steps: ["REDDIT_CREATE_REDDIT_POST"], target: { label: "Subreddit", placeholder: "SideProject", required: true }, hint: "kind 'link', url = the link, title = a non-salesy honest title (no hashtags), subreddit = target without r/." },
  { slug: "slack", name: "Slack", category: "Community", blurb: "Announce in a Slack channel.", steps: ["SLACK_SEND_MESSAGE"], target: { label: "Channel", placeholder: "#launches or C0123ABC", required: true }, hint: "channel = target. Put the caption as markdown_text or text, include the poster URL on its own line if given." },
  { slug: "discordbot", name: "Discord", category: "Community", blurb: "Post to a Discord channel via bot.", steps: ["DISCORDBOT_CREATE_MESSAGE"], target: { label: "Channel ID", placeholder: "123456789012345678", required: true }, hint: "channel_id = target, content = caption (max 2000), add poster URL on its own line so Discord embeds it." },
  { slug: "telegram", name: "Telegram", category: "Community", blurb: "Send to your channel or group.", steps: ["TELEGRAM_SEND_MESSAGE"], stepsWithImage: ["TELEGRAM_SEND_PHOTO"], target: { label: "Chat / channel", placeholder: "@mychannel or -100123…", required: true }, hint: "chat_id = target. For photo: photo = poster URL, caption max 1024 chars. For message: text = caption." },
  { slug: "gmail", name: "Gmail", category: "Outreach", blurb: "Send launch emails to your list.", steps: ["GMAIL_SEND_EMAIL"], target: { label: "Recipients", placeholder: "a@x.com, b@y.com", required: true }, hint: "recipient_email = first address of target, extra_recipients = the rest. subject = headline, body = caption as friendly plain text with the link. If poster URL is given add it at the end." },
];

export const pluginDef = (slug: string) => PLUGINS.find((p) => p.slug === slug);
export const logo = (slug: string) => `https://logos.composio.dev/api/${slug}`;
