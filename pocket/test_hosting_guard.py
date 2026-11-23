import copy
import io
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import tempfile
import shutil
import unittest
import zipfile
from hosting_guard import Guard, Rejected, sha, make_archive, selected_package

ROOT=Path(__file__).resolve().parent


class HostingGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.data=b"accepted original fixture";self.digest=sha(self.data)
        self.approved={"safe":{"sha256":self.digest,"file":"pkg/safe-"+self.digest[:8]+".fwsc"}}
        self.policy={"approved":{},"excluded":{"sloop":"Existing restriction","h1":"Built in"},"withdrawn":{}}
        self.holds={"holds":[{"ids":["araminta","shifl"],"platforms":["mac","web"],"repository":"held/project","reason":"Audit hold"},
            {"ids":["basssomething2","sillage","volna"],"platforms":["web"],"repository":"held/other","reason":"Hosting hold"}]}
        self.builtin=(ROOT.parent/"firmware/h1.rfm1").read_bytes()

    def guard(self,complete=False):return Guard(self.policy,self.holds,self.approved,{"firmwares":[]},self.builtin,complete)

    def archive(self, extra=None):
        site=self.root/"site"
        if site.exists(): shutil.rmtree(site)
        site.mkdir();(site/"data/pkg").mkdir(parents=True,exist_ok=True)
        (site/"data"/self.approved["safe"]["file"]).write_bytes(self.data)
        c={"schema":2,"firmwares":[{"id":"safe","emu":{"package":{"sha256":self.digest,"file":self.approved['safe']['file']}}}]}
        (site/"data/catalog-v2.json").write_text(json.dumps(c))
        for name,data in (extra or {}).items():
            p=site/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
        z=self.root/"finished.zip";make_archive(site,z);return z

    def test_accepted_zip_and_real_builtin_pass(self):
        z=self.archive({"firmware/h1.rfm1":self.builtin});g=self.guard(True);g.check_archive(z)
        self.assertEqual(len(g.firmware),2)

    def test_held_inserted_after_staging_is_rejected(self):
        z=self.archive()
        with zipfile.ZipFile(z,"a") as f:f.writestr("data/pkg/shifl-inserted.fwsc",self.data)
        with self.assertRaisesRegex(Rejected,"Held"):self.guard(True).check_archive(z)

    def test_held_identity_and_fingerprint_survive_renaming(self):
        metadata=json.dumps({"id":"shifl","license":"MIT"}).encode()
        def leb(n):
            out=b""
            while n>127:out+=bytes([(n&127)|128]);n>>=7
            return out+bytes([n])
        custom=b"\x04rfm1"+metadata
        binary=b"\0asm\x01\0\0\0\0"+leb(len(custom))+custom
        with self.assertRaisesRegex(Rejected,"Held"):self.guard().check_archive(self.archive({"innocent.rfm1":binary}))
        self.holds['holds'][0]['sha256']=sha(b"held-content-fixture")
        with self.assertRaisesRegex(Rejected,"Held package fingerprint"):
            self.guard().check_archive(self.archive({"innocent.txt":b"held-content-fixture"}))
        self.holds['holds'][0]['sha256']=self.digest
        with self.assertRaisesRegex(Rejected,"Held package fingerprint"):self.guard().check_archive(self.archive())

    def test_identical_packages_keep_both_permanent_ids(self):
        self.approved["second"]={"sha256":self.digest,"file":"pkg/second-"+self.digest[:8]+".fwsc"}
        z=self.archive({"data/"+self.approved['second']['file']:self.data});g=self.guard();g.check_archive(z)
        self.assertEqual({f["id"] for f in g.firmware},{"safe","second"})

    def test_unknown_original_and_existing_restriction_are_rejected(self):
        for name,data in [("data/pkg/safe-new.fwsc",b"new uncleared bytes"),("data/pkg/sloop.fwsc",b"restricted")]:
            with self.subTest(name=name),self.assertRaises(Rejected):self.guard().check_archive(self.archive({name:data}))

    def test_nested_archive_cannot_hide_held_binary(self):
        inner=io.BytesIO()
        with zipfile.ZipFile(inner,"w") as z:z.writestr("shifl.fwsc",b"held")
        with self.assertRaises(Rejected):self.guard().check_archive(self.archive({"nested.zip":inner.getvalue()}))

    def test_finished_pages_tar_is_checked_too(self):
        z=self.archive();p=self.root/"artifact.tar"
        with tarfile.open(p,"w") as t:t.add(self.root/"site",arcname=".")
        self.guard(True).check_archive(p)
        with tarfile.open(p,"a") as t:
            info=tarfile.TarInfo("pkg/volna.fwsc");info.size=4;t.addfile(info,io.BytesIO(b"held"))
        with self.assertRaises(Rejected):self.guard(True).check_archive(p)

    def test_missing_claim_and_renamed_binary_are_rejected(self):
        z=self.archive();(self.root/"site/data"/self.approved["safe"]["file"]).unlink();make_archive(self.root/"site",z)
        with self.assertRaisesRegex(Rejected,"Missing"):self.guard(True).check_archive(z)
        with self.assertRaises(Rejected):self.guard().check_archive(self.archive({"ordinary.bin":b"\x00\xff\x80not an approved asset"}))

    def test_previous_accepted_version_is_pinned_not_newly_cleared(self):
        old={"url":"https://github.com/m/safe/releases/download/v1/safe.fwsc","sha256":self.digest,"file":self.approved["safe"]["file"],"version":"1","license":"MIT"}
        entry={"id":"safe"};before={"safe":{"emu":{"package":old}}};candidate={"status":"found","sha256":"f"*64}
        selected=selected_package(entry,candidate,before,self.approved,self.holds)
        self.assertEqual(selected["sha256"],self.digest);self.assertEqual(candidate["sha256"],"f"*64)

    def test_failed_guard_cannot_reach_upload_command(self):
        z=self.archive({"data/pkg/shifl.fwsc":b"held fixture"})
        for n,value in [("policy",self.policy),("holds",self.holds),("approved",{"packages":self.approved}),("catalogue",{"firmwares":[]})]:
            (self.root/(n+".json")).write_text(json.dumps(value))
        args=[sys.executable,"-B",str(ROOT/"hosting_guard.py"),str(z),"--rfm-catalogue",str(self.root/"catalogue.json"),"--policy",str(self.root/"policy.json"),"--holds",str(self.root/"holds.json"),"--approved",str(self.root/"approved.json"),"--extract-to",str(self.root/"verified")]
        marker=self.root/"upload-was-run"
        result=subprocess.run(["bash","-e","-c",shlex.join(args)+"\n"+shlex.join(["touch",str(marker)])],capture_output=True)
        self.assertNotEqual(result.returncode,0);self.assertFalse(marker.exists());self.assertFalse((self.root/"verified").exists())

    def test_workflows_do_not_bypass_guard_with_always_upload(self):
        import re
        for workflow,needle,gate in [("pocket-emu-preview.yml","name: pocket-preview","preview_guard"),
                ("pocket-sync.yml","name: github-pages","site_guard")]:
            text=(ROOT.parent/".github/workflows"/workflow).read_text()
            blocks=re.split(r"(?m)^      - ",text)
            block=next(b for b in blocks if needle in b)
            self.assertIn("success()",block);self.assertIn("steps."+gate+".outputs.passed == 'true'",block)
            self.assertNotIn("always()",block)
        text=(ROOT.parent/".github/workflows/pocket-sync.yml").read_text()
        for gate in ("current_guard","package_guard"):
            self.assertIn("success() && steps."+gate+".outputs.passed == 'true'",text)


if __name__=="__main__":unittest.main()
