import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import YouTubePlayer from '../components/YouTubePlayer';
import { getAnimeById } from '../services/anilist';
import {
  LICENSED_CHANNELS,
  canSearchEpisodes,
  channelSearchUrl,
  findLicensedEpisodes,
  trailerVideoId
} from '../services/youtube';
import '../styles/Pages.css';

/**
 * Plays officially licensed video from YouTube.
 *
 * This page previously pointed a custom player at
 * https://stream.example.com/... - a placeholder host that never existed, so
 * nothing ever played. AniList supplies metadata only, so the video has to
 * come from a licensed distributor.
 */
export default function Watch() {
  const { id } = useParams();
  const [anime, setAnime] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const media = await getAnimeById(id);
        if (cancelled) return;
        setAnime(media);

        const title = media.title?.romaji || media.title?.english || '';

        // Only reachable when a YouTube Data API key is configured; without
        // one this resolves to [] and the trailer is used instead.
        let found = [];
        try {
          found = await findLicensedEpisodes(title);
        } catch (err) {
          found = []; // episode lookup is a bonus, never a hard failure
        }
        if (cancelled) return;

        setEpisodes(found);
        setSelected(
          found.length > 0
            ? { videoId: found[0].videoId, title: found[0].title, kind: 'episode' }
            : resolveTrailer(media)
        );
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="loader">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!anime) return <div className="error">Anime not found</div>;

  const title = anime.title?.romaji || anime.title?.english || 'This anime';

  return (
    <div className="watch-page">
      <YouTubePlayer
        videoId={selected?.videoId}
        title={selected?.title || title}
        label={
          selected?.kind === 'trailer'
            ? 'Trailer. Full episodes are on the licensed channels below.'
            : selected?.title
        }
      />

      <div className="watch-info">
        <h2>{title}</h2>

        {episodes.length > 0 && (
          <div className="episode-list">
            <h3>Episodes on licensed channels</h3>
            <div className="yt-episode-list">
              {episodes.map((ep) => (
                <button
                  key={ep.videoId}
                  className={`yt-episode-btn ${
                    selected?.videoId === ep.videoId ? 'active' : ''
                  }`}
                  onClick={() =>
                    setSelected({
                      videoId: ep.videoId,
                      title: ep.title,
                      kind: 'episode'
                    })
                  }
                >
                  {ep.title}
                  <span className="yt-source-region">{ep.channel}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="yt-sources">
          <h3>Where to watch full episodes</h3>
          <p>
            {canSearchEpisodes()
              ? 'These distributors licence the anime they upload, and stream free on YouTube at up to 1080p.'
              : 'Automatic episode lookup is off because no YouTube API key is configured, so only the trailer plays here. These distributors licence the anime they upload and stream free on YouTube at up to 1080p.'}
          </p>
          <div className="yt-source-list">
            {LICENSED_CHANNELS.map((channel) => (
              <a
                key={channel.name}
                className="yt-source-link"
                href={channelSearchUrl(channel, title)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {channel.name}
                <span className="yt-source-region">{channel.regions}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function resolveTrailer(media) {
  const videoId = trailerVideoId(media);
  if (!videoId) return null;
  return {
    videoId,
    title: `${media.title?.romaji || 'Anime'} trailer`,
    kind: 'trailer'
  };
}
