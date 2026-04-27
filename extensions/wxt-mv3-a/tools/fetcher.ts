export default async function newFetch(url:string) {
    const resp = await fetch(url, { cache: "no-cache" }).catch(e => {
        let urlsplit = url.split('/');
        let urlLen = urlsplit.length;
        let Regex = urlsplit[urlLen - 1];
        let RedirectUrl = url.split(Regex)[0];
        let w = window.open(RedirectUrl);
        // setTimeout(() => {w.close()},5000)
    });
    return resp!;
}