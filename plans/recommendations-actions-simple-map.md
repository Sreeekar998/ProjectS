# From AI search problems to practical fixes

**Project Sun · Recommendations and actions.** Seven common reasons a business is overlooked or misrepresented in AI search, and how Project Sun helps fix each one.

Editable design: [Figma — Project Sun, Recommendations and Actions (simple map)](https://www.figma.com/design/zDO3bjz8IaPqtiBJwtGoK0)

```mermaid
---
config:
  theme: base
  themeVariables:
    fontFamily: Arial
    fontSize: 15px
    lineColor: "#9AA3B2"
    clusterBkg: "#ffffff"
    clusterBorder: "#ffffff"
  flowchart:
    htmlLabels: true
    useMaxWidth: false
    curve: basis
    nodeSpacing: 14
    rankSpacing: 46
    wrappingWidth: 560
---
flowchart TB
  subgraph HDR[" "]
    direction LR
    H1["THE PROBLEM"]:::head ~~~ H2["HOW PROJECT SUN HELPS"]:::head
  end

  subgraph G1["Foundations"]
    direction LR
    P1["<b>1</b> · AI search can't read your website, so it relies on other sites to describe your business."]:::prob --> S1["<b>Make your website readable to AI search</b><br>• Let AI search tools access your site (a quick website setting)<br>• Show key details, such as prices, as plain text on your pages"]:::found
    P2["<b>2</b> · Your profiles on map, booking and directory sites are missing, incomplete or inconsistent."]:::prob --> S2["<b>Fix your business listings</b><br>• Claim and complete your Google Maps, booking and directory profiles<br>• Add missing services and prices, and keep details the same everywhere"]:::found
    P3["<b>3</b> · AI search repeats wrong facts about your business, such as the wrong price, hours or services."]:::prob --> S3["<b>Correct wrong facts at the source</b><br>• Fix the mistake on your own website or listing<br>• Ask other sites that show the wrong fact to correct it, with proof"]:::found
  end

  subgraph G2["Your message"]
    direction LR
    P4["<b>4</b> · AI search can't find clear information about you, so answers are vague or leave out what you offer."]:::prob --> S4["<b>Say it clearly on your website</b><br>• Publish the details customers ask about, such as a price range<br>• Describe each key service and location clearly on its own page"]:::message
    P5["<b>5</b> · When people compare options, AI search favors a competitor on the point buyers care about most."]:::prob --> S5["<b>Decide and state your position</b><br>• Choose where you want to compete, and where to step back<br>• Spell out your strengths on the points buyers compare"]:::message
  end

  subgraph G3["Your reputation"]
    direction LR
    P6["<b>6</b> · The articles, 'best of' lists and directories AI search relies on mention competitors, but not you."]:::prob --> S6["<b>Get featured on the sites AI search reads</b><br>• Ask to be added to relevant lists that already name your competitors<br>• Pitch your story to the publications AI search draws on"]:::reput
    P7["<b>7</b> · You have fewer reviews than competitors, or the same criticism keeps coming up in answers."]:::prob --> S7["<b>Strengthen your reviews and reputation</b><br>• Invite all recent customers to leave an honest review<br>• Fix the real issues behind repeated complaints"]:::reput
  end

  HDR ~~~ G1
  G1 ~~~ G2
  G2 ~~~ G3
  G3 ~~~ NOTE
  NOTE["ⓘ <b>How recommendations are made:</b> before suggesting any change, Project Sun first checks that the business information is correct and that the problem shows up consistently in AI search answers, not just once."]:::note

  classDef head fill:#ffffff,stroke:#ffffff,color:#5B6475,font-weight:bold
  classDef prob fill:#F6F7F9,stroke:#E2E6ED,color:#1F2A44,text-align:left
  classDef found fill:#EAF2FB,stroke:#BED5EE,color:#1F2A44,text-align:left
  classDef message fill:#EAF5EC,stroke:#C2DEC7,color:#1F2A44,text-align:left
  classDef reput fill:#F2EDF9,stroke:#D7CBEB,color:#1F2A44,text-align:left
  classDef note fill:#F2F5F9,stroke:#F2F5F9,color:#1F2A44
  style HDR fill:#ffffff,stroke:#ffffff
  style G1 fill:#ffffff,stroke:#BED5EE,color:#2E6FB7
  style G2 fill:#ffffff,stroke:#C2DEC7,color:#3B8A47
  style G3 fill:#ffffff,stroke:#D7CBEB,color:#6D4AA8
```
