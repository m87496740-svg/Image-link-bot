export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Custom Domain Image Proxy (e.g. https://img.anime-portal.xyz/uploads/img_123.jpg)
    if (request.method === "GET" && url.pathname.startsWith("/uploads/")) {
      const ghRawUrl = `https://raw.githubusercontent.com/m87496740-svg/Image-link-bot/main${url.pathname}`;
      const imgResponse = await fetch(ghRawUrl, {
        cf: { cacheEverything: true, cacheTtl: 31536000 }, // 1-Year Edge Cache for ultra-fast website loading
      });

      if (!imgResponse.ok) {
        return new Response("Image Not Found", { status: 404 });
      }

      const headers = new Headers(imgResponse.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(imgResponse.body, { status: 200, headers });
    }

    if (request.method !== "POST") {
      return new Response("Image Link Generator Bot is Live 24/7!", { status: 200 });
    }

    try {
      const update = await request.json();
      if (!update.message) return new Response("OK");

      const chatId = update.message.chat.id;
      const user = update.message.from;
      const text = update.message.text || "";
      const BOT_TOKEN = env.BOT_TOKEN;
      const LOG_CHANNEL = env.LOG_CHANNEL;
      const GITHUB_TOKEN = env.GITHUB_TOKEN;
      const ADMIN_ID = env.ADMIN_ID ? String(env.ADMIN_ID).trim() : null;
      const CUSTOM_DOMAIN = env.CUSTOM_DOMAIN ? String(env.CUSTOM_DOMAIN).trim().replace(/\/$/, "") : null;

      // 2. Strict Admin Lock Check
      if (ADMIN_ID && String(user.id) !== ADMIN_ID) {
        await sendMessage(
          BOT_TOKEN,
          chatId,
          `⛔ <b>Access Denied!</b>\n\nThis is a private bot.\n🆔 <b>Your ID:</b> <code>${user.id}</code>`
        );
        return new Response("OK");
      }

      // 3. Commands (/start, /help, /ping, /id)
      if (text === "/start" || text === "/help") {
        await sendMessage(
          BOT_TOKEN,
          chatId,
          "👋 <b>Welcome Admin! Image Direct Link Bot Ready</b>\n\n" +
            "📌 <b>For Website HD Quality:</b>\n" +
            "• <b>Normal Photo:</b> Fast 1280px Web HD\n" +
            "• <b>Max 4K Quality:</b> Tap <code>📎 → File</code> or <i>Send without compression</i>\n\n" +
            `🌐 <b>Domain:</b> <code>${CUSTOM_DOMAIN || "raw.githubusercontent.com"}</code>\n` +
            "🔒 <b>Mode:</b> Admin Locked • 24/7 Edge"
        );
        return new Response("OK");
      }

      if (text === "/ping") {
        const start = Date.now();
        await sendMessage(BOT_TOKEN, chatId, `🏓 <b>Pong!</b> Active 24/7 (${Date.now() - start}ms)`);
        return new Response("OK");
      }

      if (text === "/id") {
        await sendMessage(BOT_TOKEN, chatId, `🆔 <b>Your Telegram ID:</b> <code>${user.id}</code>`);
        return new Response("OK");
      }

      // 4. Extract Highest-Res Photo or Uncompressed Image Document
      let fileId = null;
      let qualityBadge = "Web HD (1280px)";

      if (update.message.document && update.message.document.mime_type?.startsWith("image/")) {
        fileId = update.message.document.file_id;
        qualityBadge = "Original Lossless HD";
      } else if (update.message.photo) {
        // Always pick the largest resolution array item
        fileId = update.message.photo[update.message.photo.length - 1].file_id;
        qualityBadge = "Standard Web HD";
      }

      if (!fileId) {
        await sendMessage(BOT_TOKEN, chatId, "⚠️ Please send a valid <b>Photo</b> or <b>Image File</b>.");
        return new Response("OK");
      }

      ctx.waitUntil(
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, action: "upload_photo" }),
        })
      );

      // 5. Download File from Telegram
      const fileInfoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
      const fileInfo = await fileInfoRes.json();

      if (!fileInfo.ok) {
        await sendMessage(BOT_TOKEN, chatId, "❌ Failed to fetch image from Telegram.");
        return new Response("OK");
      }

      const filePath = fileInfo.result.file_path;
      const imgRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
      const arrayBuffer = await imgRes.arrayBuffer();
      const base64Content = arrayBufferToBase64(arrayBuffer);

      // 6. Custom Slug from Caption (optional) or Timestamp Filename
      const ext = filePath.split(".").pop() || "jpg";
      const rawCaption = (update.message.caption || "").trim();
      const cleanSlug = rawCaption
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      const fileName = cleanSlug ? `${cleanSlug}_${Date.now().toString().slice(-5)}.${ext}` : `img_${Date.now()}.${ext}`;
      const repoOwner = "m87496740-svg";
      const repoName = "Image-link-bot";
      const uploadPath = `uploads/${fileName}`;

      // 7. Upload to GitHub
      const ghRes = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${uploadPath}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            "User-Agent": "Cloudflare-Worker-Bot",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `Upload ${fileName}`,
            content: base64Content,
          }),
        }
      );

      const ghData = await ghRes.json();

      if (ghRes.ok && ghData.content) {
        const directLink = CUSTOM_DOMAIN
          ? `${CUSTOM_DOMAIN}/${uploadPath}`
          : `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/${uploadPath}`;

        await sendMessage(
          BOT_TOKEN,
          chatId,
          `✅ <b>Direct Image Link Ready!</b>\n` +
            `✨ <b>Quality:</b> ${qualityBadge}\n\n` +
            `🔗 <b>URL:</b>\n<code>${directLink}</code>\n\n` +
            `📋 <i>Tap the link to copy</i>`,
          {
            inline_keyboard: [[{ text: "🌐 Open Image", url: directLink }]],
          }
        );

        // 8. Non-Blocking Background Log
        if (LOG_CHANNEL) {
          ctx.waitUntil(
            (async () => {
              const safeName = escapeHtml(user.first_name || "Admin");
              const userTag = user.username ? `@${escapeHtml(user.username)}` : safeName;
              const logCaption =
                `📸 <b>New Image Uploaded</b>\n\n` +
                `👤 <b>Admin:</b> ${userTag} (<code>${user.id}</code>)\n` +
                `✨ <b>Quality:</b> ${qualityBadge}\n` +
                `🔗 <b>Link:</b> ${directLink}`;

              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: String(LOG_CHANNEL).trim(),
                  photo: fileId,
                  caption: logCaption,
                  parse_mode: "HTML",
                }),
              });
            })()
          );
        }
      } else {
        await sendMessage(BOT_TOKEN, chatId, `❌ Upload failed: ${escapeHtml(ghData.message || "Unknown error")}`);
      }
    } catch (err) {
      // Ignore errors
    }

    return new Response("OK");
  },
};

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendMessage(token, chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
