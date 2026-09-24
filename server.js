const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
// Railway මගින් ලබාදෙන Dynamic Port එක Auto-assign කරගැනීමට:
const PORT = process.env.PORT || 3000;

app.use(cors());

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

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
            let title = $(el).find('h2, h3, .title').text().trim() || $(el).attr('title') \vert{}\vert{}$(el).text().trim();
            let img = $(el).find('img').attr('src') \vert{}\vert{}$(el).find('img').attr('data-src') || parent.find('img').attr('src') || parent.find('img').attr('data-src') || '';

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

        const title = $('h1').first().text().trim() \vert{}\vert{}$('title').text().trim();
        const image = $('meta[property="og:image"]').attr('content') \vert{}\vert{} $('.poster img, .single-poster img, article img, .entry-content img').first().attr('src') || '';

        let story = '';
        $('.entry-content p, .description p, article p').each((i, el) => {
            const text = $(el).text().trim();
            if (text && text.length > 30 && !text.includes('උපසිරැසි') && !text.includes('Sinhala Subtitles')) {
                if (!story) story = text;
            }
        });
        if (!story) story = 'No description available';

        const downloads = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            let text = $(el).text().trim();
            if (href && (href.includes('/links/') || href.includes('pixeldrain.com') || href.includes('mega.nz') || href.includes('drive.google.com') || href.includes('download') || href.includes('/dl/')) && !href.includes('sinhalasub.lk/?s=') && !href.includes('facebook.com')) {
                let quality = text || "Download Link";
                quality = quality.replace(/\n|\t/g, ' ').trim();
                if (quality.length > 60) quality = "Download Link";
                if (!downloads.some(d => d.link === href)) {
                    downloads.push({ quality, link: href });
                }
            }
        });

        res.json({ status: true, creator: "IMALSHA API", site: "sinhalasub", data: { title, image, story, downloads } });
    } catch (err) {
        res.status(500).json({ status: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
