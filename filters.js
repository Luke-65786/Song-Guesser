import { normalize } from './game.js';

export const ERAS = [
  { value: '1960', label: '1960s', seeds: ['The Beatles', 'Aretha Franklin', 'The Rolling Stones'] },
  { value: '1970', label: '1970s', seeds: ['ABBA', 'Fleetwood Mac', 'Stevie Wonder'] },
  { value: '1980', label: '1980s', seeds: ['Madonna', 'Michael Jackson', 'Prince'] },
  { value: '1990', label: '1990s', seeds: ['Mariah Carey', 'Nirvana', 'TLC'] },
  { value: '2000', label: '2000s', seeds: ['Beyoncé', 'Coldplay', 'Britney Spears'] },
  { value: '2010', label: '2010s', seeds: ['Taylor Swift', 'The Weeknd', 'Adele'] },
  { value: '2020', label: '2020s', seeds: ['Dua Lipa', 'Billie Eilish', 'Sabrina Carpenter'] },
];
export const GENRES = [
  { value: 'pop', label: 'Pop', names: ['Pop', 'Synth Pop', 'Indie Pop'], seeds: ['Madonna', 'Taylor Swift', 'Dua Lipa'] },
  { value: 'rock', label: 'Rock', names: ['Rock', 'Classic Rock', 'Hard Rock', 'Pop Rock', 'Rock & Roll'], seeds: ['Queen', 'The Rolling Stones', 'Foo Fighters'] },
  { value: 'alternative', label: 'Alternative', names: ['Alternative', 'Indie Rock'], seeds: ['Nirvana', 'Radiohead', 'Arctic Monkeys'] },
  { value: 'hiphop', label: 'Hip-Hop / Rap', names: ['Hip-Hop/Rap', 'Hip-Hop', 'Rap'], seeds: ['Kendrick Lamar', 'Eminem', 'Lauryn Hill'] },
  { value: 'rnb', label: 'R&B / Soul', names: ['R&B/Soul', 'Soul', 'Contemporary R&B'], seeds: ['Stevie Wonder', 'SZA', 'Usher'] },
  { value: 'dance', label: 'Dance', names: ['Dance', 'House', 'Disco'], seeds: ['Calvin Harris', 'David Guetta', 'Donna Summer'] },
  { value: 'electronic', label: 'Electronic', names: ['Electronic', 'Electronica', 'Techno'], seeds: ['Daft Punk', 'The Chemical Brothers', 'Kraftwerk'] },
  { value: 'country', label: 'Country', names: ['Country', 'Contemporary Country'], seeds: ['Dolly Parton', 'Shania Twain', 'Luke Combs'] },
  { value: 'jazz', label: 'Jazz', names: ['Jazz', 'Smooth Jazz', 'Vocal Jazz'], seeds: ['Miles Davis', 'Ella Fitzgerald', 'Norah Jones'] },
  { value: 'classical', label: 'Classical', names: ['Classical', 'Orchestral', 'Chamber Music'], seeds: ['Mozart', 'Beethoven', 'Yo-Yo Ma'] },
  { value: 'latin', label: 'Latin', names: ['Latin', 'Latin Pop', 'Urbano Latino', 'Reggaeton', 'Salsa and Tropical', 'Música Mexicana'], seeds: ['Shakira', 'Bad Bunny', 'Luis Miguel'] },
  { value: 'kpop', label: 'K-Pop', names: ['K-Pop'], seeds: ['BTS', 'BLACKPINK', 'TWICE'] },
  { value: 'metal', label: 'Metal', names: ['Metal', 'Heavy Metal'], seeds: ['Metallica', 'Iron Maiden', 'Black Sabbath'] },
  { value: 'soundtrack', label: 'Soundtrack', names: ['Soundtrack', 'Original Score', 'Musicals'], seeds: ['Hans Zimmer', 'John Williams', 'Lin-Manuel Miranda'] },
];

export function emptyFilters() { return { era: '', genre: '', artist: null, album: null }; }
export function filterLabel(filters) {
  const parts = [filters.era && ERAS.find(era => era.value === filters.era)?.label, filters.genre && GENRES.find(genre => genre.value === filters.genre)?.label, filters.artist?.name, filters.album?.title].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'The everything mix';
}
export function filterSongs(songs, filters) {
  const genre = GENRES.find(item => item.value === filters.genre);
  const era = ERAS.find(item => item.value === filters.era);
  return songs.filter(song => {
    if (era && (!/^\d{4}$/.test(song.year) || Number(song.year) < Number(era.value) || Number(song.year) >= Number(era.value) + 10)) return false;
    if (genre && !genre.names.some(name => normalize(name) === normalize(song.genre))) return false;
    if (filters.artist && String(song.artistId) !== String(filters.artist.id)) return false;
    if (filters.album && String(song.albumId) !== String(filters.album.id)) return false;
    return true;
  });
}
export function discoveryTerms(filters) {
  const era = ERAS.find(item => item.value === filters.era);
  const genre = GENRES.find(item => item.value === filters.genre);
  return [...new Set([...(genre?.seeds || []), ...(era?.seeds || [])])].slice(0, 6);
}
