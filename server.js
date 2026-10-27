const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

// ==========================================
// 🚀 ULTRA-FAST LIGHTWEIGHT DOTFLIX RESOLVER
// ==========================================
async function resolveDotflixLinkFast(url) {
    try {
        if (url.includes('pixeldrain.com')) {
            return url.includes('/api/file/') ? url : url.replace('/u/', '/api/file/');
        }

        console.log(`\n🔍 [FAST RESOLVER] Fetching: ${url}`);

        // 1. Fetch SinhalaSub link page
        const response = await axios.get(url, { headers: HEADERS, timeout: 8000 });
        const html = response.data;

        let dotflixUrl = null;

        // Extract Dotflix share URL via Regex or Cheerio
        const dotflixMatch = html.match(/https?:\/\/dotflix\.store\/share\/[a-zA-Z0-9]+/);
        if (dotflixMatch) {
            dotflixUrl = dotflixMatch[0];
        } else {
            const $ = cheerio.load(html);
            const href = $('a[href*="dotflix.store"]').attr('href');
            if (href) dotflixUrl = href;
        }

        if (!dotflixUrl) return url;

        console.log(`🔗 Found Dotflix Portal: ${dotflixUrl}`);

        // 2. Fetch Dotflix verification page
        const dotflixRes = await axios.get(dotflixUrl, { headers: HEADERS, timeout: 8000 });
        const dotflixHtml = dotflixRes.data;
        const $d = cheerio.load(dotflixHtml);

        // Look for Pixeldrain link in anchors
        let pixeldrainLink = $d('a[href*="pixeldrain.com"]').attr('href');

        // If not found in anchors, search raw HTML text via Regex (handles hidden scripts/redirects)
        if (!pixeldrainLink) {
            const pixMatch = dotflixHtml.match(/https?:\/\/[^\s"'<>]+pixeldrain\.com[^\s"'<>]+/i);
            if (pixMatch) {
                pixeldrainLink = pixMatch[0];
            }
        }

        if (pixeldrainLink) {
            const cleanLink = pixeldrainLink.includes('/api/file/') ? pixeldrainLink : pixeldrainLink.replace('/u/', '/api/file/');
            console.log(`✨ [RESOLVED] Direct Pixeldrain: ${cleanLink}`);
            return cleanLink;
        }

        return url;
    } catch (err) {
        console.error(`❌ [RESOLVER ERROR] for (${url}): ${err.message}`);
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

// Info & Download Endpoint (Lightning Fast Processing)
app.get('/api/v1/sinhalasub/infodl', async (req, res) => {
    try {
        const movieUrl = req.query.url;
        if (!movieUrl) return res.status(400).json({ status: false, message: "URL required" });

        console.log(`\n🔥 [INFO DL] Processing Movie URL: ${movieUrl}`);
        const response = await axios.get(movieUrl, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        let title = $('h1').first().text().trim() || $('title').text().trim();
        let image = $('meta[property="og:image"]').attr('content') || $('.poster img').first().attr('src') || '';

        let imdb_rating = $('.num, .rating, .imdb_rating').first().text().trim() || "N/A";
        let mainQuality = $('span.quality, .quality').first().text().trim() || "HD / WEB-DL";

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

        // Scrape raw download links
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

        console.log(`📦 Scraped ${downloads.length} raw links. Resolving links concurrently...`);

        // Resolve all links concurrently and instantly using lightweight requests
        const finalDownloads = await Promise.all(
            downloads.map(async (item) => {
                if (item.link.includes('/links/') || item.link.includes('dotflix')) {
                    const directUrl = await resolveDotflixLinkFast(item.link);
                    return {
                        ...item,
                        direct_link: directUrl,
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
