const EMAIL = process.env.GREATHOST_EMAIL || '';
const PASSWORD = process.env.GREATHOST_PASSWORD || '';
const CHAT_ID = process.env.CHAT_ID || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
// 你写在文件里的代理地址
const PROXY_URL = "socks5://admin123:admin321@138.68.253.225:30792";

const { firefox } = require("playwright");
const https = require('https');

async function sendTelegramMessage(message) {
    if (!BOT_TOKEN || !CHAT_ID) return;
    return new Promise((resolve) => {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' });
        const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
        const req = https.request(url, options, (res) => {
            res.on('end', () => resolve());
        });
        req.on('error', () => resolve());
        req.write(data);
        req.end();
    });
}

(async () => {
    const GREATHOST_URL = "https://greathost.es";    
    const LOGIN_URL = `${GREATHOST_URL}/login`;
    const HOME_URL = `${GREATHOST_URL}/dashboard`;
    const BILLING_URL = `${GREATHOST_URL}/billing/free-servers`;
    
    let proxyStatusTag = "🌐 直连模式";
    let serverStarted = false;

    // --- 1. 核心：解析写在文件里的 PROXY_URL ---
    const url = new URL(PROXY_URL);
    const proxyConfig = {
        server: `socks5://${url.host}`, // 这里是 138.68.253.225:30792
        username: url.username,         // 这里是 admin123
        password: url.password          // 这里是 admin321
    };
    proxyStatusTag = `🔒 代理模式 (${url.host})`;

    let browser;
    try {
        console.log(`🚀 任务启动 | 引擎: Firefox | ${proxyStatusTag}`);
        
        // 2. 启动 Firefox
        browser = await firefox.launch({ headless: true });

        // 3. 在创建上下文时【直接注入】代理的所有信息
        // 这是 Playwright 官方推荐的处理 SOCKS5 认证的写法
        const context = await browser.newContext({
            proxy: proxyConfig,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
            viewport: { width: 1280, height: 720 },
            locale: 'es-ES'
        });

        const page = await context.newPage();

        // --- 4. 抹除特征 ---
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        // --- 5. IP 检测 (验证代理是否生效) ---
        console.log("🌍 正在验证代理 IP...");
        try {
            await page.goto("https://api.ipify.org?format=json", { timeout: 20000 });
            const ipData = await page.innerText('body');
            console.log(`✅ 当前出口 IP: ${ipData}`);
        } catch (e) {
            console.warn("⚠️ IP 检测超时，可能代理响应慢，继续执行主流程...");
        }

        // --- 6. 登录 ---
        console.log("🔑 正在登录...");
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
        await page.fill('input[name="email"]', EMAIL);
        await page.fill('input[name="password"]', PASSWORD);
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: "networkidle" }),
        ]);
        console.log("✅ 登录成功");

        // --- 7. 开机检查 ---
        await page.goto(HOME_URL, { waitUntil: "networkidle" });
        if (await page.locator('span.badge-danger, .status-offline').first().isVisible()) {
            console.log("⚠️ 服务器离线，尝试开机...");
            const startBtn = page.locator('button:has-text("Start"), .btn-start').first();
            if (await startBtn.isVisible()) {
                await startBtn.click();
                serverStarted = true;
                await page.waitForTimeout(3000);
            }
        }

        // --- 8. 续期流程 ---
        console.log("🔍 进入续期页面...");
        await page.goto(BILLING_URL, { waitUntil: "networkidle" });
        await page.getByRole('link', { name: 'View Details' }).first().click();
        await page.waitForNavigation({ waitUntil: "networkidle" });
        
        const serverId = page.url().split('/').pop();
        const beforeHours = parseInt(await page.textContent('#accumulated-time')) || 0;
        
        const renewBtn = page.locator('#renew-free-server-btn');
        const btnText = await renewBtn.innerText();

        if (btnText.includes('Wait')) {
            console.log("⏳ 还在冷却中...");
            await sendTelegramMessage(`⏳ 服务器 ${serverId} 还在冷却。时长: ${beforeHours}h`);
            return;
        }

        console.log("⚡ 执行续期点击...");
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(1000);
        await renewBtn.click({ force: true });

        // 等待并校验
        await page.waitForTimeout(20000);
        await page.reload();
        const afterHours = parseInt(await page.textContent('#accumulated-time')) || 0;
        
        await sendTelegramMessage(`🎉 续期成功!\nID: ${serverId}\n时长: ${beforeHours}h -> ${afterHours}h\nIP: ${proxyStatusTag}`);
        console.log(`🎉 任务完成: ${beforeHours}h -> ${afterHours}h`);

    } catch (err) {
        console.error("❌ 崩溃:", err.message);
        await sendTelegramMessage(`🚨 脚本异常: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
})();
