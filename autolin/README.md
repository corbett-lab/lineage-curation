Import propose_sublineages.py from https://github.com/jmcbroome/autolin (commit 32d9a52)

### Example Demonstration
As a beginner example, as well as proof of concept, we have extracted the XFG clade from the SARS-CoV-2 global phylogeny using the command `matUtils extract -i public-latest.all.masked.pb.gz -c XFG -o XFG.pb`. 

### Getting started
To generate autolin designations, the software takes as input a Mutation Annotated Tree (MAT) in protcol buffer format. Instruction on creating a MAT can be found at https://usher-wiki.readthedocs.io/en/latest/UShER.html#methodology. 

In it's most basic iteration, autolin can be run with the command `python3 propose_sublineages.py -i {name of MAT}` however, several considerations must be taken into account for quality automated lineage designations. 

First, many pathogens have existing lineage/strain naming conventions that are already standing, and working with these existing conventions is likely the most appropriate way to move forward with further lineage names. For this reason, inputting a MAT with annotated nodes is more useful for certain pathogens. Instructions on annotating a MAT can also be found within the UShER documentation. Annotated MATs for certain pathogens such as M. tuberculosis and SARS-CoV-2 are available at https://hgdownload.gi.ucsc.edu/hubs/GCF/000/195/955/GCF_000195955.2/UShER_Mtb_SRA/ and https://hgdownload.soe.ucsc.edu/goldenPath/wuhCor1/UShER_SARS-CoV-2/.

Please note that running `python3 propose_sublineages.py -i {name of MAT}` on the annotated global phylogenies of M. tuberculosis and ESPECIALLY SARS-CoV-2 may result in significant run times as there are many existing lineages and sublineages that would all be examined for their potential sublineage designations. For this reason, large, well-annotated pathogens will likely require intentional targeting of clades of interest (see below for details). 

To create meaningful annotations on top of existing conventions, and to tailor lineage annotations to specific pathogens, certain flags in the propose_sublineages.py program will assist in creating better, more customized designations. 

The autolin algorithm is not intended to overwrite any existing lineages and will seek to create meaningful, unbiased suggestions to replace manual inspection and designation of lineage splits.

### Using arguments to improve lineage designations

As noted above, for global phylogenies, a general approach of identifying all potential new annotations for an entire tree will be computationally expensive for well-annotated global phylogenies. Most notably, SARS-CoV-2 has 4864 existing clade labels and querying all of these for new lineage designations is time-consuming and not necessarily valuable as certain lineages are older and less relevant currently. ** add helper script for querying metadata for newer lineages or samples ** `--annotation` or `-a` allow for users to select clade names that they specifically are interested in proposing sublineages for. (Note that `-a` will only work if the MAT is annotated and the user makes a direct reference to an existing annotation)

For example:
If user wants to annotate lineage XBB in the SARS-CoV-2 global phlyogeny, the MAT can be retrieved with `wget http://hgdownload.soe.ucsc.edu/goldenPath/wuhCor1/UShER_SARS-CoV-2/public-latest.all.masked.pb.gz` and the command `python3 propose_sublineages.py -i public-latest.all.masked.pb.gz -a XBB`

** work on this ? maybe make a helper fucntion to determine how long a particular predicton will make?**
Tip: using `matUtils summary -i {name of tree } -c clades.tsv` the user can receive a list of clades and the number of sublineages within that clade whhich affect how long samples with membership in that clade 

the `--recursive` (`-r`) flag, when called, will indicate a recursive employment of the autolin algorithm, and will designate sublineages of the lineages suggested by autolin, allowing for several layers of designation. To prevent the splitting of sublineages into N=1 size, the `-m` or `--minsamples` command requires that each lineage carry at least m sample weight (without special weighting, m is equivalent to minimum number of samples assigned to a lineage)(default m is 10). `-m` is usable with or without `-r` but is especially important when recursive rounds of lineage designation are employed.

the `--mutweights` or `-w` flag acknowledges that certain mutations may not contribute as meaningful of changes to an organism and that certain mutations should be weighted more strongly in their consideration of differences between samples in the same taxa. **to add: helper script for identifying n/ns mutations and prescribing weights to them. also: potentially for certain pathogens weighting certain regions higher. also: potentially hypermutation mutations. **

### Example lineage designation.
As an example, we have extracted a subtree of lineage4.8 from the MTB global phylogeny. The original file is available in the repository as `mtb.4.8.pb` and it's visual without autolin designations is available as `mtb.4.8.jsonl.gz`. 
#### mtb.4.8 autolin settings 
The most basic command to designate new lineages within `mtb.4.8.pb` is `python3 propose_sublineages.py -i mtb.4.8.pb -o mtb.4.8.autolin.pb`. The results of this can be observed in `mtb.4.8.autolin.jsonl.gz`. To generate recursive sublineages the command is `python3 propose_sublineages.py -i mtb.4.8.pb -r -o mtb.4.8.autolin.r.pb` which relies on a default `-m` setting of 10 and results in lineages as shown in `mtb.4.8.autolin.r.jsonl.gz`. The resulting clades and their sizes can be viewed with `matUtils summary -i mtb.4.8.autolin.r.pb -c mtb.4.8.autolin.r.cladecounts.tsv` and `-m` can be toggled according to user needs. Lower `-m` values will increase the number of proposed sublineages and decrease the number of samples in a proposed sublineage. 



####

### Getting lineage designations into Taxonium
To create a file for visualization in Taxonium users should use the `-o` or `--output` flag in propose_sublineages.py. Supply an output MAT name `{your tree}autolin.pb`. This output file will have both existing and proposed autolin annotations on the internal nodes. To convert this file into a `jsonl.gz` type for taxonium, use usher_to_taxonium which is available in TaxoniumTools https://github.com/theosanderson/taxonium/tree/master/taxoniumtools. 

To assist in the conversion between the autolin outputted pb and the taxonium input jsonl.gz, `convert_autolinpb_totax.py` will take the name of the autolin pb with `-a` and output a `.jsonl.gz` which can be used for viewing newly proposed lineages.
** note `convert_autolinpb_totax.py` is currently optimized for the example tree `XXXX`. this script will be refined and likely turned into a snakemake pipeline in future releases.

Notes on usher_to_taxonium:
usher_to_taxonium has sparse documentation and many hardcoded quirks. ** keep filling this in 









