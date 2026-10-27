const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

// ==========================================
// 🛠️ ADVANCED PUPPETEER MULTI-STEP RESOLVER WITH LOGS
// ==========================================
async function resolveDotflixLink(url) {
    let browser = null;
    try {
        console.log(`\n==============================================`);
        console.log(`🔍 [RESOLVER START] Processing Link: ${url}`);
        console.log(`==============================================`);

        if (url.includes('pixeldrain.com')) {
            const cleanPix = url.includes('/api/file/') ? url : url.replace('/u/', '/api/file/');
            console.log(`✅ Already a Pixeldrain link: ${cleanPix}`);
            return cleanPix;
        }

        browser = await puppeteer.launch({
            headless: true,
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
        
        console.log(`🌐 Navigating to redirect/verification page...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Loop to click through verification steps (Verify Link 1, 2, 3 / Download Now)
        for (let step = 1; step <= 4; step++) {
            console.log(`⏳ [STEP ${step}] Waiting for timer & looking for verification buttons...`);
            await new Promise(r => setTimeout(r, 4000)); // Wait for timer countdown

            const clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('a, button, div.btn'));
                const targetBtn = buttons.find(b => {
                    const text = (b.innerText || '').toUpperCase();
                    return text.includes('VERIFY LINK') || text.includes('DOWNLOAD NOW') || text.includes('CLICK HERE') || text.includes('PROCEED');
                });
                if (targetBtn) {
                    targetBtn.click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                console.log(`🖱️ [STEP ${step}] Successfully clicked verification/download button!`);
            } else {
                console.log(`ℹ️ [STEP ${step}] No active verification button found, checking current state...`);
            }
        }

        // Final wait for redirect to complete
        console.log(`⏳ Waiting for final redirect to complete...`);
        await new Promise(r => setTimeout(r, 5000));

        const finalUrl = page.url();
        console.log(`🎯 Current Browser URL: ${finalUrl}`);

        // Check if page contains a direct pixeldrain link in DOM
        const domPixeldrain = await page.evaluate(() => {
            const a = document.querySelector('a[href*="pixeldrain.com"]');
            return a ? a.href : null;
        });

        await browser.close();

        let resolved = domPixeldrain || finalUrl;
        if (resolved.includes('pixeldrain.com')) {
            resolved = resolved.includes('/api/file/') ? resolved : resolved.replace('/u/', '/api/file/');
        }

        console.log(`✨ [RESOLVER SUCCESS] Final Direct Link: ${resolved}`);
        console.log(`==============================================\n`);
        return resolved;

    } catch (err) {
        if (browser) await browser.close();
        console.error(`❌ [RESOLVER ERROR] for (${url}): ${err.message}`);
        return url;
    }
}

// Root Status Route
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

        console.log(`\n🔍 [SEARCH] Query: "${query}"`);
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

        console.log(`🎯 Found ${results.length} search results.`);
        res.json({ status: true, creator: "IMALSHA API", site: "sinhalasub", results_count: results.length, data: results });
    } catch (err) {
        console.error(`❌ [SEARCH ERROR]: ${err.message}`);
        res.status(500).json({ status: false, error: err.message });
    }
});

// Info & Download Endpoint
app.get('/api/v1/sinhalasub/infodl', async (req, res) => {
    try {
        const movieUrl = req.query.url;
        if (!movieUrl) return res.status(400).json({ status: false, message: "URL required" });

        console.log(`\n🔥 [INFO DL] Processing Movie URL: ${movieUrl}`);
        const response = await axios.get(movieUrl, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        let title = $('h1').first().text().trim();
        if (!title) title = $('title').text().trim();

        let image = $('meta[property="og:image"]').attr('content');
        if (!image) image = $('.poster img, .single-poster img, article img, .entry-content img').first().attr('src') || '';

        // IMDb Rating
        let imdb_rating = $('.num, .rating, .imdb_rating, .score, .imdb, span[itemprop="ratingValue"]').first().text().trim();
        if (!imdb_rating) {
            const pageText = $.text();
            const match = pageText.match(/IMDb\s*:?\s*([\d\.]+(\/10)?)/i);
            if (match) imdb_rating = match[1];
        }
        if (!imdb_rating) imdb_rating = "N/A";

        // Main Quality
        let mainQuality = $('.quality, .mvoie-quality, .badge-quality, .quality-tag, .dt_quality').first().text().trim();
        if (!mainQuality) {
            const match = title.match(/(1080p|720p|480p|2160p|4K|WEB-DL|HDTV|BluRay|HD)/i);
            if (match) mainQuality = match[0];
        }
        if (!mainQuality) mainQuality = "HD / WEB-DL";

        let story = '';
        $('.entry-content p, .description p, article p').each((i, el) => {
            const text = $(el).text().trim();
            if (text && text.length > 30 && !text.includes('උපසිරැසි') && !text.includes('Sinhala Subtitles')) {
                if (!story) story = text;
            }
        });
        if (!story) story = 'No description available';

        const downloads = [];

        const isIgnored = (url) => {
            if (!url || url.startsWith('#') || url.startsWith('javascript:')) return true;
            const ignoreList = [
                'facebook.com', 'twitter.com', 'pinterest.com', 'whatsapp.com', 
                'youtube.com', 't.me/share', 'sinhalasub.lk/?s=', '/category/', 
                '/tag/', '/movies/', '/tvshows/', 'adstudio.cloud'
            ];
            return ignoreList.some(domain => url.toLowerCase().includes(domain));
        };

        // Scrape Download Tables & Links
        $('tr, .link-row, .dl-row, table tbody tr').each((i, el) => {
            const linkEl = $(el).find('a[href]');
            const href = linkEl.attr('href') || '';

            if (href && !isIgnored(href)) {
                const rowText = $(el).text().replace(/\s+/g, ' ').trim();

                const qMatch = rowText.match(/(FHD\s*1080p|HD\s*720p|SD\s*480p|1080p|720p|480p|2160p|4K|WEB-DL|BluRay)/i);
                const quality = qMatch ? qMatch[0].toUpperCase() : "HD";

                const sMatch = rowText.match(/(\d+(\.\d+)?\s*(GB|MB))/i);
                const size = sMatch ? sMatch[0] : "N/A";

                let server = linkEl.text().trim();
                if (!server || server.length > 20) {
                    const parentTab = $(el).closest('.tab-pane, div[id]').attr('id') || '';
                    server = parentTab || "Server";
                }

                server = server.replace(/[\n\t]/g, '').trim();
                const fullName = `🎥 [Movie File] ${server} - ${quality} (${size})`;

                if (!downloads.some(d => d.link === href)) {
                    downloads.push({
                        name: fullName,
                        server: server,
                        quality: quality,
                        size: size,
                        link: href
                    });
                }
            }
        });

        if (downloads.length === 0) {
            $('a[href]').each((i, el) => {
                const href = $(el).attr('href') || '';
                if (!isIgnored(href) && (href.includes('/links/') || href.includes('pixeldrain') || href.includes('dotflix') || href.includes('dlserver'))) {
                    const parentText = $(el).parent().text().replace(/\s+/g, ' ').trim();

                    const qMatch = parentText.match(/(FHD\s*1080p|HD\s*720p|SD\s*480p|1080p|720p|480p)/i);
                    const quality = qMatch ? qMatch[0].toUpperCase() : "HD";

                    const sMatch = parentText.match(/(\d+(\.\d+)?\s*(GB|MB))/i);
                    const size = sMatch ? sMatch[0] : "N/A";

                    let server = $(el).text().trim() || "Download";

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
        }

        console.log(`📦 Scraped ${downloads.length} raw download links. Resolving through Puppeteer bypass...`);

        // ==========================================
        // 🚀 RESOLVE LINKS USING PUPPETEER IN PARALLEL
        // ==========================================
        const finalDownloads = await Promise.all(
            downloads.map(async (item) => {
                if (item.link.includes('/links/') || item.link.includes('dotflix')) {
                    const directUrl = await resolveDotflixLink(item.link);
                    return {
                        ...item,
                        direct_link: directUrl, // Real resolved direct link!
                        original_link: item.link
                    };
                }
                return item;
            })
        );

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
        console.error(`❌ [INFO DL ERROR]: ${err.message}`);
        res.status(500).json({ status: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
