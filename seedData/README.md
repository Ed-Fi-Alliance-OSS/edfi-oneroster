The scripts `sql/01_descriptors.sql` and `sql/02_descriptorMappings.sql` install the required 1EdTech-namespaced descriptor values and descriptorMappings from Ed-Fi default descriptor values to corresponding 1EdTech-namespaced descriptor values.

The `*.jsonl` files and `lightbeam.yml` in this directory _are here for convenience_, in case you prefer to seed this data via the Ed-Fi API instead. It may be particularly helpful if you want to make custom descriptorMappings from a non-Ed-Fi-namespaced set of descriptor values to the 1EdTech values and run OneRoster on an Ed-Fi ODS that uses custom descriptors.

To use this, you would modify the `base_url`, `client_id`, and `client_secret` in `lightbeam.yml` for your Ed-Fi API, then
```bash
cd seedData/
lightbeam send
```
(Learn more about [`lightbeam` here](https://github.com/edanalytics/lightbeam).)