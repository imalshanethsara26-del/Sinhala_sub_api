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

// Auto Find Chrome Executable on Render
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

// Ultra-Fast Direct Link Extractor
async function resolvePageLink(page, url) {
    try {
        console.log(`\n🔍 [RESOLVER] Processing: ${url}`);

        if (url.includes('pixeldrain.com')) {
            return url.includes('/api/file/') ? url : url.replace('/u/', '/api/file/');
        }

        // Navigate to the sinhalasub link page
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // Wait for potential redirect or frame load to dotflix
        let targetUrl = url;
        try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 });
            targetUrl = page.url();
        } catch (e) {}

        console.log(`🌐 Landed URL: ${targetUrl}`);

        // If landing on dotflix or link page, click any available verify/download button instantly
        for (let i = 0; i < 4; i++) {
            await new Promise(r => setTimeout(r, 2000));

            // Check if Pixeldrain link is already in the DOM
            const directPix = await page.evaluate(() => {
                const pixEl = document.querySelector('a[href*="pixeldrain.com"]');
                if (pixEl && pixEl.href) return pixEl.href;

                // Search all anchors for pixeldrain or direct download
                const anchors = Array.from(document.querySelectorAll('a'));
                const found = anchors.find(a => a.href && (a.href.includes('pixeldrain.com') || a.href.includes('/api/file/')));
                return found ? found.href : null;
            });

            if (directPix) {
                let clean = directPix.includes('/api/file/') ? directPix : directPix.replace('/u/', '/api/file/');
                console.log(`✨ [SUCCESS] Found Direct Pixeldrain: ${clean}`);
                return clean;
            }

            // Click verification buttons
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('a, button, div.btn, span.btn, input[type="submit"]'));
                const btn = btns.find(b => {
                    const txt = (b.innerText || b.value || '').toUpperCase();
                    return txt.includes('DOWNLOAD') || txt.includes('VERIFY') || txt.includes('CLICK') || txt.includes('PROCEED') || txt.includes('NEXT');
                });
                if (btn) btn.click();
            });
        }

        // Final fallback check on current page HTML via Axios / Cheerio if puppeteer gets stuck
        const finalPageUrl = page.url();
        if (finalPageUrl.includes('pixeldrain.com')) {
            return finalPageUrl.includes('/api/file/') ? finalPageUrl : finalPageUrl.replace('/u/', '/api/file/');
        }

        // Try scraping the final page content
        const pageContent = await page.content();
        const $c = cheerio.load(pageContent);
        const htmlPix = $c('a[href*="pixeldrain.com"]').attr('href');
        if (htmlPix) {
            return htmlPix.includes('/api/file/') ? htmlPix : htmlPix.replace('/u/', '/api/file/');
        }

        console.log(`⚠️ Could not resolve direct link, returning original: ${url}`);
        return url;

    } catch (err) {
        console.error(`❌ [RESOLVER ERROR]: ${err.message}`);
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

            let img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || parent.find('img').attr('src') || '';

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

        console.log(`📦 Scraped ${downloads.length} raw links. Launching Chrome resolver...`);

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
