Import propose_sublineages.py from https://github.com/jmcbroome/autolin (commit 32d9a52)

### Getting started
To generate autolin designations, the software takes as input a Mutation Annotated Tree (MAT) in protcol buffer format. Instruction on creating a MAT can be found at https://usher-wiki.readthedocs.io/en/latest/UShER.html#methodology. 

In it's most basic iteration, autolin can be run with the command `python3 propose_sublineages.py -i {name of MAT}` however, several considerations must be taken into consideration for quality automated lineage designations. 

First, many pathogens have existing lineage/strain naming conventions that are already standing, and working with these existing conventions is likely the most appropriate way to move forward with further lineage names. For this reason, inputting a MAT with annotated nodes is more useful for certain pathogens. Instructions on annotating a MAT can also be found within the UShER documentation. Annotated MATs for certain pathogens such as M. tuberculosis and SARS-CoV-2 are available at https://hgdownload.gi.ucsc.edu/hubs/GCF/000/195/955/GCF_000195955.2/UShER_Mtb_SRA/ and https://hgdownload.soe.ucsc.edu/goldenPath/wuhCor1/UShER_SARS-CoV-2/.

To create meaningful annotations on tops of existing conventions, and to tailor lineage annotations to specific pathogens, certain flags in the propose_sublineages.py program will assist in creating better, more customized designations. 

The autolin algorithm is not intended to overwrite any existing lineages and will seek to create meaningful, unbiased suggestions to replace manual inspection and designation of lineage splits.

### Using arguments to improve lineage designations
the `--recursive` (`-r`) flag, when called, will indicate a recursive employment of the autolin algorithm, and will designate sublineages of the lineages suggested by autolin, allowing for several layers of designation. To prevent the splitting of sublineages into N=1 size, the `-m` or `--minsamples` command requires that each lineage carry at least m sample weight (without special weighting, m is equivalent to minimum number of samples assigned to a lineage)(default m is 10). `-m` is usable with or without `-r` but is especially important when recursive rounds of lineage designation are employed.

the `--mutweights` or `-w` flag acknowledges that certain mutations may not contribute as meaningful of changes to an organism and that certain mutations should be weighted more strongly in their consideration of differences between samples in the same taxa. **to add: helper script for identifying n/ns mutations and prescribing weights to them. also: potentially for certain pathogens weighting certain regions higher. also: potentially hypermutation mutations. **






