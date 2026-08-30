/**
 * Repositories offered as one tap in Settings.
 *
 * Typing a raw GitHub URL on a phone is miserable and easy to get subtly
 * wrong, so the ones worth having are listed here with a button. The manual
 * field stays for anything not on the list.
 *
 * Each entry says what it actually contains. That matters more than it
 * sounds: a repository that installs cleanly and then shows nothing looks
 * broken, when really it just holds no anime.
 */

export const KNOWN_REPOSITORIES = [
  {
    name: 'Animiru sources',
    url: 'https://raw.githubusercontent.com/perezfiles01-droid/animiru/main/extensions/index.json',
    description:
      'Maintained with this app. Its index is generated from the sources it '
      + 'holds, so anything added there appears here without this URL '
      + 'changing. Open it to see what it currently carries.',
    contains: 'anime'
  },
  {
    name: 'Mangayomi (official)',
    url: 'https://raw.githubusercontent.com/kodjodevf/mangayomi-extensions/main/index.json',
    description:
      'The official Mangayomi repository. Its own repo.json says manga and '
      + 'novels only, so Animiru will list its sources as not usable here - '
      + 'included so that is visible rather than puzzling.',
    contains: 'manga'
  }
];

export default KNOWN_REPOSITORIES;
