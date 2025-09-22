import subprocess
import argparse
import os 
import sys

'''
next iteration of this will likely be a snakemake workflow
'''
'''
This currently assumes that the user can run matUtils and usher_to_taxonium 
'''

'''
sequence of commands:
run autolin to get autolin.pb (make user do this currently)
run matUtils extract -i autolin.pb -C autolin_clade.pb -o autolin_clade.tsv (make user do this currently)
either rename first column to strain and optionally rename other columns 
or join autolin_clade.tsv with metadata file to get metadata file with autolin annotations
run usher_to_taxonium with --clade_types to convert autolin.pb to taxonium json

#make an effort to separate script for sc2 and everything else at some point 
'''
def parse_args():
    parser = argparse.ArgumentParser(description="Convert an AutoLIN protobuf file to a Taxonium JSON file.")
    parser.add_argument("--autolin_pb_path", "-a", type=str, required=True, help="Path to the input AutoLIN protobuf file.")
    parser.add_argument("--sars-cov-2", "-sc2", action="store_true", help="Flag indicating if the data is SARS-CoV-2. Special \
        options must be handled for SC2")
    return parser.parse_args()

def convert_autolinpb_totax(autolin_pb_path, parent_dir):
    """
    Convert an AutoLIN protobuf file to a Taxonium JSON file.

    Parameters:
    autolin_pb_path (str): Path to the input AutoLIN protobuf file.
    taxonium_json_path (str): Path to the output Taxonium JSON file.
    """
    
    command = ["matUtils", "summary",
               "-i", autolin_pb_path,
               "-C", "./autolin_clade.tsv",
               ]
    #print(command)
    try:
        subprocess.run(command, check=True)
    except Exception as e:
        print(f"matUtils command ({' '.join(command)}) failed: {e}", file=sys.stderr)
        sys.exit(1)

def fix_metadata(clade_file):
    #rename first column to strain
    command = "sed -i '1s/^[^ \t]*/strain/' "+clade_file
    subprocess.run(command, shell=True, check=True)

def usher_to_taxonium(autolin_pb_path, clade_file, sc2):
    #this is a crude version that doesnt have any option for column name changing 
    #next iteration will need to read column names so im not hardcoding them 
    #will deal with this in next iteration
    print('clade file', clade_file)
    if sc2:
        #command= ["usher_to_taxonium","-i", autolin_pb_path, "--clade_types", "nextclade,pango", "-m", clade_file, "-c", "strain,annotation_1,annotation_2", "-o", autolin_pb_path.replace(".pb", ".jsonl.gz")]
        print("Currently, SARS-CoV-2 is unsupported. Check back in later releases. Exiting.", file=sys.stderr)
        sys.exit(1)
    
    command= ["usher_to_taxonium","-i", autolin_pb_path, "--clade_types", "pango", "-m", clade_file, "-c", "strain,annotation_1", "-o", autolin_pb_path.replace(".pb", ".jsonl.gz")]
    #print(command)
    subprocess.run(command, check=True)


def main(): 
    args = parse_args()
    autolin_pb_path = args.autolin_pb_path
    parent_dir = os.path.dirname(os.path.abspath(autolin_pb_path))
    sc2 = args.sars_cov_2
    #print(parent_dir)
    print(autolin_pb_path)
    convert_autolinpb_totax(autolin_pb_path, parent_dir)
    #make sure autolin_clade.tsv is not empty
    clade_file = None

    with open(parent_dir+"/autolin_clade.tsv", 'r') as f:
        if sum(1 for _ in f) == 1:
            print(f"Error: {parent_dir}/autolin_clade.tsv was not created or is empty.", file=sys.stderr)
            sys.exit(1)        
        else:
            clade_file = parent_dir+"/autolin_clade.tsv"
            print('clade', clade_file)
            fix_metadata(clade_file)
    usher_to_taxonium(autolin_pb_path, clade_file, sc2)

if __name__ == "__main__":
    main()