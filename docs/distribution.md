# Dataset distribution

The application bundles `data/statech-2.0.1.json.gz`, a UTF-8 format-1 JSON catalog compressed with gzip. Both Godot exports decompress it internally. Players do not need Minecraft, Java, or extraction tools to use it. The source catalog remains marked incomplete while required adapters are unfinished.

The bundle preserves all fields of the compiled planning catalog. It contains resource and recipe facts, calculated machine rules, captured structure predicates, progression references, and unsupported-entry reports. The distribution script rejects unreviewed top-level, resource, and recipe fields. Game binaries, original recipe scripts, quest prose, images, sounds, and saves are outside its inputs. Static player-head component identities in the catalog come from registered mod recipes, not imported player worlds.

The [attribution](../data/ATTRIBUTION.md), [mod declaration audit](../data/provenance/distribution-audit.json), [source revisions](../data/provenance/sources.json), and [input hashes](../data/provenance/statech-2.0.1-inputs.json) preserve source information. License declarations are reported as the mods supply them; they are not a substitute for the original licenses and do not relicense upstream code or assets. Primary source license texts are included under `data/licenses/`.

Minecraft's [usage guidelines](https://www.minecraft.net/en-us/usage-guidelines) call for clear independent attribution and prohibit redistribution of game files. The planner uses its own interface and artwork. Keep the unofficial-product notice in the application and publishing materials, and supply the publisher's contact details on the itch.io page before publishing.

After rebuilding the player catalog with the extraction tools, regenerate the audit and bundle:

```powershell
python tools/extraction/audit_distribution.py --instance F:/sti2-work/instance --dataset F:/sti2-work/player-dataset.json --output data/provenance/distribution-audit.json
python tools/extraction/bundle_dataset.py --source F:/sti2-work/player-dataset.json --output data/statech-2.0.1.json.gz --audit data/provenance/distribution-audit.json --inputs data/provenance/statech-2.0.1-inputs.json --manifest data/provenance/distribution-manifest.json
node tools/validate_dataset.mjs data/statech-2.0.1.json.gz
python tools/verify_distribution.py
```

The manifest records compressed and uncompressed hashes, source-catalog and audit hashes, counts, and completeness. Compression is deterministic for a given catalog. Updating the bundle must retain source attribution, pass data and arithmetic checks, and be verified in both exported applications. Keep the fictional `data/example.json` for small tests and as a format example.
