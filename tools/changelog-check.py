"""History-free regression proof: safe to copy to the rented check hosts."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ChangelogCheck(unittest.TestCase):
    def test_cli_without_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tool = root / 'changelog.py'
            tool.write_bytes((ROOT / 'tools/changelog.py').read_bytes())
            fixture = root / 'history.json'
            fixture.write_bytes((ROOT / 'tools/fixtures/changelog.json').read_bytes())
            notes = root / 'notes.json'
            notes.write_text(json.dumps({'2': 'Smoother steering', '3': None}))
            output, page = root / 'CHANGELOG.md', root / 'changes/index.html'
            args = [sys.executable, str(tool), '--fixture', str(fixture), '--notes', str(notes),
                    '--output', str(output), '--html', str(page)]

            def run(*extra):
                return subprocess.run(args + list(extra), cwd=root, capture_output=True, text=True,
                                      env={**os.environ, 'TZ': 'Asia/Tokyo'})

            self.assertEqual(run().returncode, 0)
            first = output.read_bytes(), page.read_bytes()
            text = output.read_text()
            self.assertIn('## 2026-11-16', text)  # UTC midnight is still the previous Atlantic day.
            self.assertIn('## 2026-07-01', text)  # ADT, not a fixed AST offset.
            self.assertIn('Initial commit', text)
            self.assertIn('Smoother steering', text)
            self.assertNotIn('Internal tooling', text)
            self.assertLess(text.index('2026-11-16'), text.index('2026-07-01'))
            self.assertIn('<time datetime="2026-11-16">16 November 2026</time>', page.read_text())
            self.assertIn('Dates use Atlantic time', page.read_text())
            self.assertLess(page.read_text().index('Back to the game'), page.read_text().index('class="overline"'))
            self.assertNotIn('Initial commit', page.read_text())
            self.assertIn('Smoother steering', page.read_text())
            self.assertNotIn('Internal tooling', page.read_text())
            self.assertIn('min-height:44px', page.read_text())
            self.assertIn('font-size:12px', page.read_text())
            notes.write_text(json.dumps({'2': {'player': 'Drive & explore <b>'}, '3': None}))
            self.assertEqual(run().returncode, 0)
            self.assertIn('&lt;b&gt;', page.read_text())
            self.assertNotIn('Smoother steering', output.read_text())
            notes.write_text(json.dumps({'2': 'Smoother steering', '3': None}))
            self.assertEqual(run().returncode, 0)
            self.assertNotIn('<script', page.read_text())
            self.assertEqual(run('--check').returncode, 0)
            self.assertEqual(first, (output.read_bytes(), page.read_bytes()))
            output.write_text('stale\n')
            self.assertNotEqual(run('--check').returncode, 0)
            self.assertEqual(output.read_text(), 'stale\n')
            self.assertEqual(run().returncode, 0)
            for unsafe in ['Contact test@example.org', 'Visit 123 Main Road', 'At 42A Old Mill Rd',
                           'Civic #123', '/Users/test/private/file', r'C:\Users\test\file']:
                notes.write_text(json.dumps({'2': unsafe}))
                before = output.read_bytes(), page.read_bytes()
                result = run()
                self.assertNotEqual(result.returncode, 0, unsafe)
                self.assertNotIn(unsafe, result.stderr)
                self.assertEqual(before, (output.read_bytes(), page.read_bytes()))
            notes.write_text('{}')
            fixture.write_text(json.dumps([{'date': '2026-11-17T01:00:00+00:00',
                                            'title': 'Visit 123 Main Road (#2)'}]))
            self.assertNotEqual(run().returncode, 0)  # Default titles also fail closed.

    def test_integration(self):
        build = (ROOT / 'tools/build_site.sh').read_text()
        self.assertIn('tools/changelog.py', build)
        self.assertIn('$SITE/changes', build)
        about = (ROOT / 'tools/about-pages.mjs').read_text()
        self.assertIn('href="/changes/"', about)
        self.assertIn("What's new", about)
        # The title card links absolutely, like About/Help, so the private test page reaches the live page.
        self.assertIn('CHANGES_URL[', (ROOT / 'web/src/title.ts').read_text())
        credits = (ROOT / 'web/src/credits.ts').read_text()
        for host in ['mmm.fakkeldy.ca', 'justdrive.fakkeldy.ca']:
            self.assertIn(f"'https://{host}/changes/'", credits)


if __name__ == '__main__':
    unittest.main()
