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
// 🛠️ DOTFLIX / SINHALASUB LINK RESOLVER FUNCTION
// ==========================================
async function resolveDotflixLink(url) {
    try {
        // 1. Direct Pixeldrain link එකක් නම්
        if (url.includes('pixeldrain.com')) {
            return url.includes('/api/file/') ? url : url.replace('/u/', '/api/file/');
        }

        // 2. Sinhalasub /links/ හෝ Dotflix link එකට Request යැවීම
        const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });
        const html = response.data;
        const currentUrl = response.request.res.responseUrl || url;

        let dotflixUrl = null;

        // HTML එක ඇතුළේ Dotflix Share URL එක තියෙදැයි Regex මගින් පරීක්ෂාව
        const dotflixMatch = html.match(/https?:\/\/dotflix\.store\/share\/[a-zA-Z0-9]+/);
        if (dotflixMatch) {
            dotflixUrl = dotflixMatch[0];
        } else if (currentUrl.includes('dotflix.store')) {
            dotflixUrl = currentUrl;
        } else {
            const $p = cheerio.load(html);
            dotflixUrl = $p('a[href*="dotflix.store"]').attr('href');
        }

        // Dotflix URL එක හමුවූයේ නැත්නම් Original URL එක ලබාදෙයි
        if (!dotflixUrl) return url;

        // 3. Dotflix Page එක Fetch කර Pixeldrain / Direct Link එක extraction කිරීම
        const dotflixRes = await axios.get(dotflixUrl, { headers: HEADERS, timeout: 10000 });
        const $d = cheerio.load(dotflixRes.data);

        // A. Pixeldrain Download බටන් එක සෙවීම
        let pixeldrain = $d('a[href*="pixeldrain.com"]').attr('href');
        if (pixeldrain) {
            return pixeldrain.includes('/api/file/') ? pixeldrain : pixeldrain.replace('/u/', '/api/file/');
        }

        // B. Direct Resume Download බටන් එක සෙවීම
        let direct = $d('a:contains("Direct Resume Download")').attr('href') || 
                     $d('a:contains("Download Direct Link")').attr('href');
        if (direct) {
            return direct;
        }

        return dotflixUrl;
    } catch (err) {
        console.error(`Error resolving link (${url}):`, err.message);
        return url; // Error එකක් ආවොත් original link එකම Return කරයි
    }
}

// Root Status Route
app.get('/', (req, res) => {
    res.json({
        status: true,
        message: "IMALSHA API is Live 🚀",
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
    try {
        const movieUrl = req.query.url;
        if (!movieUrl) return res.status(400).json({ status: false, message: "URL required" });

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

        // Ignored Links
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

        // Fallback Links Collector
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

        // ==========================================
        // 🚀 RESOLVE DOTFLIX / PASS LINKS IN PARALLEL
        // ==========================================
        const finalDownloads = await Promise.all(
            downloads.map(async (item) => {
                if (item.link.includes('/links/') || item.link.includes('dotflix')) {
                    const directUrl = await resolveDotflixLink(item.link);
                    return {
                        ...item,
                        direct_link: directUrl, // Real direct download link
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
        res.status(500).json({ status: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
