const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

// Auto Find Chrome Executable
function getChromeExecutablePath() {
    const possiblePaths = [
        '/opt/render/project/src/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome',
        '/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome',
        process.env.PUPPETEER_EXECUTABLE_PATH
    ];

    for (const p of possiblePaths) {
        if (p && fs.existsSync(p)) return p;
    }

    const baseCache = '/opt/render/project/src/.cache/puppeteer/chrome';
    if (fs.existsSync(baseCache)) {
        try {
            const dirs = fs.readdirSync(baseCache);
            for (const dir of dirs) {
                const autoPath = path.join(baseCache, dir, 'chrome-linux64', 'chrome');
                if (fs.existsSync(autoPath)) return autoPath;
            }
        } catch (e) {}
    }
    return undefined;
}

// Single Link Resolver using Page instance
async function resolvePageLink(page, url) {
    try {
        console.log(`\n🔍 [RESOLVER] Processing Link: ${url}`);

        if (url.includes('pixeldrain.com')) {
            return url.includes('/api/file/') ? url : url.replace('/u/', '/api/file/');
        }

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // Loop through verification steps (Verify Link 1, 2, 3)
        for (let step = 1; step <= 3; step++) {
            await new Promise(r => setTimeout(r, 3500));

            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('a, button, div.btn'));
                const targetBtn = buttons.find(b => {
                    const text = (b.innerText || '').toUpperCase();
                    return text.includes('VERIFY LINK') || text.includes('DOWNLOAD NOW') || text.includes('CLICK HERE') || text.includes('PROCEED');
                });
                if (targetBtn) targetBtn.click();
            });
        }

        await new Promise(r => setTimeout(r, 4000));

        const finalUrl = page.url();
        const domPixeldrain = await page.evaluate(() => {
            const a = document.querySelector('a[href*="pixeldrain.com"]');
            return a ? a.href : null;
        });

        let resolved = domPixeldrain || finalUrl;
        if (resolved.includes('pixeldrain.com')) {
            resolved = resolved.includes('/api/file/') ? resolved : resolved.replace('/u/', '/api/file/');
        }

        console.log(`✨ [SUCCESS] Direct Link: ${resolved}`);
        return resolved;
    } catch (err) {
        console.error(`❌ [ERROR] for (${url}): ${err.message}`);
        return url;
    }
}

// Root Route
app.get('/', (req, res) => {
    res.json({
        status: true,
        creator: "IMALSHA API",
        site: "sinhalasub",
        endpoints: {
            search: "/api/v1/sinhalasub/search?q=movie_name",
            infodl: "/api/v1/sinhalasub/infodl?url=movie_url"
        }
    });
});

// Search Endpoint
app.get('/api/v1/sinhalasub/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ status: false, message: "Search term required" });

        const searchUrl = "https://sinhalasub.lk/?s=" + encodeURIComponent(query);
        const response = await axios.get(searchUrl, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);
        const results = [];

        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            const parent = $(el).closest('article, .result-item, .item, div');
            
            let title = $(el).find('h2, h3, .title').text().trim();
            if (!title) title = $(el).attr('title') || '';
            if (!title) title = $(el).text().trim();

            let img = $(el).find('img').attr('src');
            if (!img) img = $(el).find('img').attr('data-src');
            if (!img) img = parent.find('img').attr('src');
            if (!img) img = parent.find('img').attr('data-src') || '';

            if (href.includes('sinhalasub.lk') && (href.includes('/movies/') || href.includes('/tvshows/')) && title.length > 2) {
                title = title.replace(/\t|\n/g, '').trim();
                if (!results.some(r => r.link === href)) {
                    results.push({ title, image: img, link: href });
                }
            }
        });

        res.json({ status: true, creator: "IMALSHA API", site: "sinhalasub", results_count: results.length, data: results });
    } catch (err) {
        res.status(500).json({ status: false, error: err.message });
    }
});

// Info & Download Endpoint
app.get('/api/v1/sinhalasub/infodl', async (req, res) => {
    let browser = null;
    try {
        const movieUrl = req.query.url;
        if (!movieUrl) return res.status(400).json({ status: false, message: "URL required" });

        console.log(`\n🔥 [INFO DL] Processing Movie URL: ${movieUrl}`);
        const response = await axios.get(movieUrl, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        let title = $('h1').first().text().trim() || $('title').text().trim();
        let image = $('meta[property="og:image"]').attr('content') || $('.poster img').first().attr('src') || '';

        let imdb_rating = $('.num, .rating, .imdb_rating').first().text().trim() || "N/A";
        let mainQuality = $('.quality').first().text().trim() || "HD / WEB-DL";

        let story = '';
        $('.entry-content p, article p').each((i, el) => {
            const text = $(el).text().trim();
            if (text && text.length > 30 && !text.includes('උපසිරැසි')) {
                if (!story) story = text;
            }
        });
        if (!story) story = 'No description available';

        const downloads = [];

        const isIgnored = (url) => {
            if (!url || url.startsWith('#') || url.startsWith('javascript:')) return true;
            const ignoreList = ['facebook.com', 'twitter.com', 'whatsapp.com', 'youtube.com', 't.me/share', 'sinhalasub.lk/?s='];
            return ignoreList.some(domain => url.toLowerCase().includes(domain));
        };

        $('tr, .link-row, table tbody tr').each((i, el) => {
            const linkEl = $(el).find('a[href]');
            const href = linkEl.attr('href') || '';

            if (href && !isIgnored(href)) {
                const rowText = $(el).text().replace(/\s+/g, ' ').trim();
                const qMatch = rowText.match(/(FHD\s*1080p|HD\s*720p|SD\s*480p|1080p|720p|480p)/i);
                const quality = qMatch ? qMatch[0].toUpperCase() : "HD";
                const sMatch = rowText.match(/(\d+(\.\d+)?\s*(GB|MB))/i);
                const size = sMatch ? sMatch[0] : "N/A";

                let server = linkEl.text().trim() || "Server";
                server = server.replace(/[\n\t]/g, '').trim();

                if (!downloads.some(d => d.link === href)) {
                    downloads.push({
                        name: `🎥 [Movie File] ${server} - ${quality} (${size})`,
                        server: server,
                        quality: quality,
                        size: size,
                        link: href
                    });
                }
            }
        });

        console.log(`📦 Scraped ${downloads.length} raw links. Launching single Chrome instance for Queue processing...`);

        // Launch SINGLE browser instance for all links to save RAM
        const chromePath = getChromeExecutablePath();
        browser = await puppeteer.launch({
            headless: true,
            executablePath: chromePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        // PROCESS LINKS SEQUENTIALLY (ONE BY ONE)
        const finalDownloads = [];
        for (const item of downloads) {
            if (item.link.includes('/links/') || item.link.includes('dotflix')) {
                const directUrl = await resolvePageLink(page, item.link);
                finalDownloads.push({
                    ...item,
                    direct_link: directUrl,
                    original_link: item.link
                });
            } else {
                finalDownloads.push(item);
            }
        }

        await browser.close();

        res.json({
            status: true,
            creator: "IMALSHA API",
            site: "sinhalasub",
            data: {
                title,
                imdb_rating,
                quality: mainQuality,
                image,
                story,
                downloads: finalDownloads
            }
        });

    } catch (err) {
        if (browser) await browser.close();
        console.error(`❌ [INFO DL ERROR]: ${err.message}`);
        res.status(500).json({ status: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
